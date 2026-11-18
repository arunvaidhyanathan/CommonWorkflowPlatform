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

print(f"---- {results['pass']} passed, {results['fail']} failed")
sys.exit(1 if results["fail"] else 0)
