"""End-to-end checks for the runtime work API against a running local stack.

Needs workflow-runtime on :8081 with the seeded users (Database/local.sql) and
the "other" tenant user created by this script. Run:
    python3 -I services/workflow-runtime/e2e/runtime_work_test.py
Exits non-zero if any check fails.
"""
import json
import pathlib
import subprocess
import sys
import urllib.error
import urllib.request
import uuid

BASE = "http://localhost:8081/runtime"
SAMPLES = pathlib.Path(__file__).resolve().parents[3] / "Designer" / "samples"
PASSWORD = "password"  # seeded local-only users (Database/local.sql)
results = {"pass": 0, "fail": 0}


def call(method, path, token=None, body=None):
    data = None if body is None else json.dumps(body).encode()
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return r.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read()
        return e.code, json.loads(raw) if raw else None


def check(name, actual, expected):
    ok = actual == expected
    results["pass" if ok else "fail"] += 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f" (expected {expected!r}, got {actual!r})"))


def login(username):
    status, body = call("POST", "/auth/login", body={"username": username, "password": PASSWORD})
    assert status == 200, f"login {username}: {status} {body}"
    return body["token"], body["user"]["id"]


def psql(sql):
    subprocess.run(["psql", "-q", "-d", "cwp", "-c", sql], check=True, capture_output=True)


def task_names(token, flt):
    return sorted(t["name"] for t in call("GET", f"/tasks?filter={flt}", token)[1])


def find_task(token, flt, name, instance_id):
    return next(t for t in call("GET", f"/tasks?filter={flt}", token)[1]
                if t["name"] == name and t["instanceId"] == instance_id)


ADMIN, ADMIN_ID = login("admin")
DESIGNER, DESIGNER_ID = login("designer")
APPROVER, APPROVER_ID = login("approver")
# A second tenant, to prove isolation.
psql("""insert into tenants(id,name,slug) values ('00000000-0000-0000-0000-000000000002','Other','other') on conflict do nothing;
insert into app_auth.users(id,email,username,password_hash) values ('00000000-0000-0000-0000-0000000000b1','other','other',crypt('password',gen_salt('bf'))) on conflict do nothing;
insert into profiles(id,tenant_id,role,email) values ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-000000000002','tenant_admin','other') on conflict do nothing;""")
OTHER, _ = login("other")

# Deploy the KYC samples and a one-task BPMN process (offered to the "designer" role group).
for key, spec, xml in [
    ("kycAssessmentService", "DMN", (SAMPLES / "kyc-risk-decisions.dmn").read_text()),
    ("kycOnboardingCase", "CMMN", (SAMPLES / "kyc-onboarding-case.cmmn").read_text()),
    ("expenseClaim", "BPMN", """<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:flowable="http://flowable.org/bpmn" targetNamespace="http://waas.citi.com/bpmn/e2e">
  <process id="expenseClaim" name="Expense Claim" isExecutable="true">
    <startEvent id="start" />
    <sequenceFlow id="f1" sourceRef="start" targetRef="review" />
    <userTask id="review" name="Review Expense" flowable:candidateGroups="designer" />
    <sequenceFlow id="f2" sourceRef="review" targetRef="end" />
    <endEvent id="end" />
  </process>
</definitions>"""),
]:
    status, _ = call("POST", "/deployments", ADMIN, {"name": key, "specType": spec, "manifest": [
        {"definitionKey": key, "name": key, "specType": spec, "xml": xml}]})
    check(f"deploy {spec} {key}", status, 201)

defs = {d["key"]: d["kind"] for d in call("GET", "/definitions", DESIGNER)[1]}
check("definitions list the KYC case", defs.get("kycOnboardingCase"), "case")
check("definitions list the BPMN process", defs.get("expenseClaim"), "process")
check("other tenant sees none of these definitions", "kycOnboardingCase" in
      {d["key"] for d in call("GET", "/definitions", OTHER)[1]}, False)

# ---- CMMN case: group routing, claim rules, decision-driven routing
applicant = {"country": "IR", "productType": "CURRENT_ACCOUNT", "expectedMonthlyVolume": 5000,
             "isPep": False, "customerType": "INDIVIDUAL"}
status, case = call("POST", "/instances", APPROVER,
                    {"kind": "case", "definitionKey": "kycOnboardingCase", "businessKey": "KYC-" + uuid.uuid4().hex[:6],
                     "variables": applicant})
check("approver can start a case", status, 201)
CASE = case["id"]
check("start records who started it", case["startUserId"], APPROVER_ID)

collect = find_task(DESIGNER, "available", "Collect Customer Documents", CASE)
check("kycAnalyst task is offered to the designer (group member)", collect["candidateGroups"], ["kycAnalyst"])
check("approver is not offered it (not in kycAnalyst)",
      any(t["instanceId"] == CASE for t in call("GET", "/tasks?filter=available", APPROVER)[1]), False)
check("approver cannot claim a task not offered to them", call("POST", f"/tasks/{collect['id']}/claim", APPROVER)[0], 404)
check("designer claims it", call("POST", f"/tasks/{collect['id']}/claim", DESIGNER)[0], 204)
check("claimed task moves to designer's 'mine'", collect["id"] in [t["id"] for t in call("GET", "/tasks?filter=mine", DESIGNER)[1]], True)
check("a claimed task cannot be claimed again", call("POST", f"/tasks/{collect['id']}/claim", ADMIN)[0], 409)
check("admin cannot complete a task someone else holds", call("POST", f"/tasks/{collect['id']}/complete", ADMIN, {})[0], 403)
check("designer completes it", call("POST", f"/tasks/{collect['id']}/complete", DESIGNER, {"documentsVerified": True})[0], 204)

wealth = find_task(APPROVER, "available", "Source of Wealth Review", CASE)
check("HIGH risk routes to EDD, offered to eddTeam", wealth["candidateGroups"], ["eddTeam"])
check("EDD task carries its form key", wealth["formKey"], "kyc-source-of-wealth")

status, detail = call("GET", f"/instances/case/{CASE}", DESIGNER)
check("case detail readable in tenant", status, 200)
check("decision result stored on the case", detail["variables"]["kycAssessmentService"]["kycRiskTier"][0]["riskTier"], "HIGH")
check("task variable from completion stored on the case", detail["variables"].get("documentsVerified"), True)
states = {p["name"]: p["state"] for p in detail["planItems"]}
check("plan items show the EDD stage active", states.get("Enhanced Due Diligence"), "active")
check("plan items show standard review never started", states.get("Standard Review"), "available")
check("other tenant cannot read the case", call("GET", f"/instances/case/{CASE}", OTHER)[0], 404)
check("other tenant cannot see its tasks", call("GET", f"/tasks/{wealth['id']}", OTHER)[0], 404)

check("designer may update case variables", call("PUT", f"/instances/case/{CASE}/variables", DESIGNER, {"note": "checked"})[0], 204)
check("approver may not update case variables", call("PUT", f"/instances/case/{CASE}/variables", APPROVER, {"note": "x"})[0], 403)
check("designer cannot terminate", call("DELETE", f"/instances/case/{CASE}", DESIGNER)[0], 403)
check("admin terminates the case", call("DELETE", f"/instances/case/{CASE}", ADMIN)[0], 204)
check("terminated case shows as terminated", call("GET", f"/instances/case/{CASE}", ADMIN)[1]["instance"]["state"], "terminated")
check("terminated case's tasks are gone", any(t["instanceId"] == CASE for t in call("GET", "/tasks?filter=all", ADMIN)[1]), False)
check("only admins list all tasks", call("GET", "/tasks?filter=all", DESIGNER)[0], 403)

# ---- BPMN process: role group, completion variables, history
status, proc = call("POST", "/instances", DESIGNER, {"kind": "process", "definitionKey": "expenseClaim",
                                                      "variables": {"amount": 120}})
check("designer starts a process", status, 201)
PROC = proc["id"]
review = find_task(DESIGNER, "available", "Review Expense", PROC)
check("task offered to the 'designer' role group", review["candidateGroups"], ["designer"])
check("completing an unclaimed offered task claims it first",
      call("POST", f"/tasks/{review['id']}/complete", DESIGNER, {"approved": True})[0], 204)
status, pdetail = call("GET", f"/instances/process/{PROC}", DESIGNER)
check("process completed", pdetail["instance"]["state"], "completed")
check("ended process still shows its variables (history)", pdetail["variables"], {"amount": 120, "approved": True})

# ---- Group management drives task visibility
status, proc2 = call("POST", "/instances", DESIGNER, {"kind": "case", "definitionKey": "kycOnboardingCase",
                                                       "variables": dict(applicant, country="GB")})
check("admin removes designer from kycAnalyst", call("PUT", f"/design/members/{DESIGNER_ID}/groups", ADMIN, {"groups": []})[0], 204)
check("designer no longer offered kycAnalyst work",
      any(t["instanceId"] == proc2["id"] for t in call("GET", "/tasks?filter=available", DESIGNER)[1]), False)
check("only admins manage groups", call("PUT", f"/design/members/{DESIGNER_ID}/groups", DESIGNER, {"groups": ["x"]})[0], 403)
check("admin restores the group", call("PUT", f"/design/members/{DESIGNER_ID}/groups", ADMIN, {"groups": ["kycAnalyst"]})[0], 204)
members = {m["email"]: m["groups"] for m in call("GET", "/design/members", ADMIN)[1]}
check("member list shows groups", members["designer"], ["kycAnalyst"])
call("DELETE", f"/instances/case/{proc2['id']}", ADMIN)

# ---- Decisions: list, evaluate a decision service, explain which rules matched
decisions = {d["key"]: d["type"] for d in call("GET", "/decisions", DESIGNER)[1]}
check("decision service is listed with its type", decisions.get("kycAssessmentService"), "decision_service")
check("other tenant does not see the decision", "kycAssessmentService" in
      {d["key"] for d in call("GET", "/decisions", OTHER)[1]}, False)
status, ev = call("POST", "/decisions/kycAssessmentService/evaluate", DESIGNER,
                  dict(applicant, country="GB", isPep=True))
check("evaluate a decision service", status, 200)
check("PEP is HIGH risk regardless of country", ev["result"]["kycRiskTier"][0]["riskTier"], "HIGH")
traces = {t["key"]: t for t in ev["decisions"]}
check("trace covers every decision in the service", sorted(traces),
      ["kycCountryRisk", "kycDocumentRequirements", "kycMonitoringFrequency", "kycProductRisk", "kycRiskTier"])
check("trace shows the PEP rule (rule 1) matched", traces["kycRiskTier"]["matchedRules"], [1])
check("trace shows the hit policy", traces["kycMonitoringFrequency"]["hitPolicy"], "PRIORITY")
check("unknown decision -> 404", call("POST", "/decisions/nope/evaluate", DESIGNER, {})[0], 404)
check("other tenant cannot evaluate it", call("POST", "/decisions/kycAssessmentService/evaluate", OTHER, {})[0], 404)

# ---- Plan item actions: manual activation, disable/enable, user event listener
status, c3 = call("POST", "/instances", DESIGNER, {"kind": "case", "definitionKey": "kycOnboardingCase",
                                                    "variables": dict(applicant, country="GB")})
C3 = c3["id"]


def plan_item(name):
    return next(p for p in call("GET", f"/instances/case/{C3}", DESIGNER)[1]["planItems"]
                if p["name"] == name and p["state"] not in ("completed", "terminated"))


req = plan_item("Request Additional Document")
check("manual item is offered (enabled) with start/disable", (req["state"], req["actions"]), ("enabled", ["start", "disable"]))
check("disable sets it aside", call("POST", f"/plan-items/{req['id']}/disable", DESIGNER)[0], 204)
check("disabled item can only be enabled", plan_item("Request Additional Document")["actions"], ["enable"])
check("a disabled item cannot be started", call("POST", f"/plan-items/{req['id']}/start", DESIGNER)[0], 409)
check("enable offers it again", call("POST", f"/plan-items/{req['id']}/enable", DESIGNER)[0], 204)
check("start activates it", call("POST", f"/plan-items/{req['id']}/start", DESIGNER)[0], 204)
check("starting it creates its human task", "Request Additional Document" in
      [t["name"] for t in call("GET", f"/instances/case/{C3}", DESIGNER)[1]["openTasks"]], True)
withdraw = plan_item("Customer Withdraws")
check("user event listener offers trigger", withdraw["actions"], ["trigger"])
check("other tenant cannot act on plan items", call("POST", f"/plan-items/{withdraw['id']}/trigger", OTHER)[0], 404)
check("unknown action -> 409", call("POST", f"/plan-items/{withdraw['id']}/start", DESIGNER)[0], 409)
check("trigger the withdrawal", call("POST", f"/plan-items/{withdraw['id']}/trigger", DESIGNER)[0], 204)
check("withdrawal terminates the case", call("GET", f"/instances/case/{C3}", DESIGNER)[1]["instance"]["state"], "terminated")

# ---- Migration: move running instances to a new version (#8)
def bpmn(task_id, task_name):
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:flowable="http://flowable.org/bpmn" targetNamespace="http://waas.citi.com/bpmn/e2e">
  <process id="migrationDemo" name="Migration Demo" isExecutable="true">
    <startEvent id="start" />
    <sequenceFlow id="f1" sourceRef="start" targetRef="{task_id}" />
    <userTask id="{task_id}" name="{task_name}" flowable:candidateGroups="designer" />
    <sequenceFlow id="f2" sourceRef="{task_id}" targetRef="end" />
    <endEvent id="end" />
  </process>
</definitions>"""


def deploy(key, spec, xml):
    return call("POST", "/deployments", ADMIN, {"name": key, "specType": spec, "manifest": [
        {"definitionKey": key, "name": key, "specType": spec, "xml": xml}]})[0]


import time

deploy("migrationDemo", "BPMN", bpmn("check", "Check Claim"))
old_def = call("GET", "/definitions/process/migrationDemo/versions", ADMIN)[1][0]
p1 = call("POST", "/instances", DESIGNER, {"kind": "process", "definitionKey": "migrationDemo"})[1]["id"]
p2 = call("POST", "/instances", DESIGNER, {"kind": "process", "definitionKey": "migrationDemo"})[1]["id"]
p3 = call("POST", "/instances", DESIGNER, {"kind": "process", "definitionKey": "migrationDemo"})[1]["id"]
deploy("migrationDemo", "BPMN", bpmn("verify", "Verify Claim"))
versions = call("GET", "/definitions/process/migrationDemo/versions", ADMIN)[1]
new_version = versions[0]["version"]
check("versions list shows running instances on the old version",
      next(v["runningInstances"] for v in versions if v["definitionId"] == old_def["definitionId"]) >= 3, True)
req = {"kind": "process", "instanceIds": [p1], "targetKey": "migrationDemo", "targetVersion": new_version}
status, report = call("POST", "/migrations/validate", ADMIN, req)
check("renamed activity without a mapping fails validation", report["valid"], False)
check("migrating an invalid plan is refused, nothing changes", call("POST", "/migrations", ADMIN, req)[0], 409)
req["activityMappings"] = [{"from": "check", "to": "verify"}]
check("with a check->verify mapping it validates", call("POST", "/migrations/validate", ADMIN, req)[1]["valid"], True)
check("non-admins cannot validate migrations", call("POST", "/migrations/validate", DESIGNER, req)[0], 403)
check("other tenant cannot touch these instances", call("POST", "/migrations/validate", OTHER, req)[0], 404)
check("migrate one instance", call("POST", "/migrations", ADMIN, req)[1], {"migrated": 1})
check("its open task is now the new version's task",
      [t["name"] for t in call("GET", f"/instances/process/{p1}", DESIGNER)[1]["openTasks"]], ["Verify Claim"])

batch_req = {"kind": "process", "sourceDefinitionId": old_def["definitionId"], "targetKey": "migrationDemo",
             "targetVersion": new_version, "activityMappings": [{"from": "check", "to": "verify"}]}
status, batch = call("POST", "/migrations/batch", ADMIN, batch_req)
check("batch migration of the whole old version starts", status, 200)
for _ in range(60):
    batch = call("GET", f"/migrations/batches/process/{batch['id']}", ADMIN)[1]
    if batch["completeTime"]:
        break
    time.sleep(0.5)
check("batch completes asynchronously", bool(batch["completeTime"]), True)
check("every remaining old instance moved",
      [t["name"] for i in (p2, p3) for t in call("GET", f"/instances/process/{i}", DESIGNER)[1]["openTasks"]],
      ["Verify Claim", "Verify Claim"])
check("other tenant cannot read the batch", call("GET", f"/migrations/batches/process/{batch['id']}", OTHER)[0], 404)

c_mig = call("POST", "/instances", DESIGNER, {"kind": "case", "definitionKey": "kycOnboardingCase",
                                               "variables": dict(applicant, country="GB")})[1]["id"]
deploy("kycOnboardingCase", "CMMN", (SAMPLES / "kyc-onboarding-case.cmmn").read_text())
case_version = call("GET", "/definitions/case/kycOnboardingCase/versions", ADMIN)[1][0]["version"]
creq = {"kind": "case", "instanceIds": [c_mig], "targetKey": "kycOnboardingCase", "targetVersion": case_version}
check("case migration to an identical new version validates", call("POST", "/migrations/validate", ADMIN, creq)[1]["valid"], True)
check("case migrated", call("POST", "/migrations", ADMIN, creq)[1], {"migrated": 1})
check("the case keeps its open work after migrating", [t["name"] for t in call("GET", f"/instances/case/{c_mig}", DESIGNER)[1]["openTasks"]],
      ["Collect Customer Documents"])

# ---- Dynamic injection: ad-hoc work in one running instance (#9)
check("approver cannot inject tasks", call("POST", f"/instances/process/{p1}/inject-task", APPROVER,
                                           {"name": "Extra check", "assignee": DESIGNER_ID})[0], 403)
check("assignee must be a member of the tenant", call("POST", f"/instances/process/{p1}/inject-task", DESIGNER,
                                                      {"name": "Extra check", "assignee": str(uuid.uuid4())})[0], 400)
check("designer injects a task into a running process", call("POST", f"/instances/process/{p1}/inject-task", DESIGNER,
                                                             {"name": "Extra check", "assignee": DESIGNER_ID})[0], 201)
check("injected task is in the assignee's inbox", "Extra check" in
      [t["name"] for t in call("GET", "/tasks?filter=mine", DESIGNER)[1] if t["instanceId"] == p1], True)
check("other tenant cannot inject", call("POST", f"/instances/process/{p1}/inject-task", OTHER,
                                         {"name": "x", "assignee": DESIGNER_ID})[0], 404)
stage = next(p for p in call("GET", f"/instances/case/{c_mig}", DESIGNER)[1]["planItems"]
             if p["name"] == "Document Collection" and p["state"] == "active")
status, inj = call("POST", f"/instances/case/{c_mig}/inject-plan-item", DESIGNER,
                   {"elementId": "PI_CollectDocs", "name": "Ad-hoc document check", "stageInstanceId": stage["id"]})
check("designer injects another instance of a plan item into a stage", status, 201)
check("injected task is offered to its group (kycAnalyst)", "Ad-hoc document check" in
      [t["name"] for t in call("GET", "/tasks?filter=available", DESIGNER)[1] if t["instanceId"] == c_mig], True)
status, gated = call("POST", f"/instances/case/{c_mig}/inject-plan-item", DESIGNER,
                     {"elementId": "PI_Escalate", "name": "Ad-hoc escalation"})
check("an injected item keeps its entry criteria (waits for the SLA timer)",
      next(p["state"] for p in call("GET", f"/instances/case/{c_mig}", DESIGNER)[1]["planItems"]
           if p["id"] == gated["planItemInstanceId"]), "available")
for i in (p1, p2, p3):
    call("DELETE", f"/instances/process/{i}", ADMIN)
call("DELETE", f"/instances/case/{c_mig}", ADMIN)

# ---- BPMN samples through the API: scripts, mail, signals, ad-hoc, conditional/variable events (#6, #10)
# Needs the runtime started with CWP_SCRIPTS_ENABLED=true and the dev mailbox (run-local.sh does both).
MAILBOX = SAMPLES.parents[1] / ".local-logs" / "mailbox.txt"
check("deploy scripted expense claim", deploy("expenseClaim", "BPMN", (SAMPLES / "expense-claim-process.bpmn").read_text()), 201)
check("deploy customer onboarding", deploy("customerOnboarding", "BPMN", (SAMPLES / "customer-onboarding-process.bpmn").read_text()), 201)

mail_before = MAILBOX.read_text() if MAILBOX.exists() else ""
claim = call("POST", "/instances", DESIGNER, {"kind": "process", "definitionKey": "expenseClaim", "variables": {
    "amount": 120, "employeeEmail": "e2e@example.com", "reviewers": [DESIGNER_ID, APPROVER_ID]}})[1]["id"]
for token in (DESIGNER, APPROVER):
    mine = [t for t in call("GET", "/tasks?filter=mine", token)[1] if t["instanceId"] == claim]
    check("each reviewer gets their own Peer Review", [t["name"] for t in mine], ["Peer Review"])
    call("POST", f"/tasks/{mine[0]['id']}/complete", token, {"vote": "approve"})
cd = call("GET", f"/instances/process/{claim}", DESIGNER)[1]
check("approved claim completed", cd["instance"]["state"], "completed")
check("script tasks ran (budget reserved, votes tallied)", (cd["variables"]["budgetReserved"], cd["variables"]["approved"]), (True, True))
time.sleep(0.5)
new_mail = (MAILBOX.read_text() if MAILBOX.exists() else "")[len(mail_before):]
check("mail task delivered to the dev mailbox", "e2e@example.com" in new_mail and "Expense claim approved" in new_mail, True)

claim2 = call("POST", "/instances", DESIGNER, {"kind": "process", "definitionKey": "expenseClaim", "variables": {
    "amount": 120, "employeeEmail": "e2e@example.com", "reviewers": [DESIGNER_ID]}})[1]["id"]
waiting = call("GET", f"/instances/process/{claim2}", DESIGNER)[1]["waitingOn"]
check("detail shows the withdrawal signal it waits for", [(w["kind"], w["name"]) for w in waiting], [("signal", "claimWithdrawn")])
check("a signal it does not wait for -> 409", call("POST", f"/instances/process/{claim2}/signal/other", DESIGNER)[0], 409)
check("other tenant cannot signal it", call("POST", f"/instances/process/{claim2}/signal/claimWithdrawn", OTHER)[0], 404)
check("send the withdrawal signal", call("POST", f"/instances/process/{claim2}/signal/claimWithdrawn", DESIGNER)[0], 204)
cd2 = call("GET", f"/instances/process/{claim2}", DESIGNER)[1]
check("withdrawal event sub-process ended the claim", (cd2["instance"]["state"], cd2["variables"].get("withdrawn")), ("completed", True))

onb = call("POST", "/instances", DESIGNER, {"kind": "process", "definitionKey": "customerOnboarding",
                                            "variables": dict(applicant, country="GB")})[1]["id"]
kyc_tasks = [t for t in call("GET", "/tasks?filter=available", DESIGNER)[1] if t["name"] == "Collect Customer Documents"]
check("the process started the KYC case (its first task is offered)", len(kyc_tasks) >= 1, True)
kyc_case = kyc_tasks[0]["instanceId"]
call("POST", f"/tasks/{kyc_tasks[0]['id']}/complete", DESIGNER, {})
std = next(t for t in call("GET", "/tasks?filter=available", DESIGNER)[1] if t["instanceId"] == kyc_case and t["name"] == "Standard Review")
call("POST", f"/tasks/{std['id']}/complete", DESIGNER, {})
od = call("GET", f"/instances/process/{onb}", DESIGNER)[1]
check("KYC result came back into the process", od["variables"]["kycResult"]["kycRiskTier"][0]["riskTier"], "LOW")
check("ad-hoc activities offered, none started", sorted(w["activityId"] for w in od["waitingOn"] if w["kind"] == "adhoc"),
      ["onlineBanking", "orderCard", "overdraft"])
for activity, flag in (("orderCard", "cardOrdered"), ("onlineBanking", "onlineBankingReady")):
    check(f"start ad-hoc {activity}", call("POST", f"/instances/process/{onb}/adhoc/{activity}", DESIGNER)[0], 204)
    task = next(t for t in call("GET", "/tasks?filter=available", DESIGNER)[1] if t["instanceId"] == onb)
    call("POST", f"/tasks/{task['id']}/complete", DESIGNER, {flag: True})
od = call("GET", f"/instances/process/{onb}", DESIGNER)[1]
check("completion condition closed the ad-hoc sub-process (overdraft never needed)", od["activeActivityIds"], ["awaitRiskReview"])
call("PUT", f"/instances/process/{onb}/variables", DESIGNER, {"riskReviewed": True})
check("updating a variable re-evaluates the conditional event", call("GET", f"/instances/process/{onb}", DESIGNER)[1]["activeActivityIds"], ["awaitWelcomeCall"])
call("PUT", f"/instances/process/{onb}/variables", DESIGNER, {"welcomeCallDone": True})
check("variable listener event fired and onboarding completed", call("GET", f"/instances/process/{onb}", DESIGNER)[1]["instance"]["state"], "completed")

print(f"---- {results['pass']} passed, {results['fail']} failed")
sys.exit(1 if results["fail"] else 0)
