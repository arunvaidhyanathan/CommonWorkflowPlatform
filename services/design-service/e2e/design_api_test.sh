#!/bin/bash
# End-to-end checks for the design-time API (design-service on :8083) and login/members (identity-service on :8082)
# (seeded users from Database/local.sql). Start design-service with IDENTITY_CACHE_TTL=PT0S: the
# promotion/deactivation checks expect role changes to apply at once (the default lags up to 30s).
# Run: bash services/design-service/e2e/design_api_test.sh
D=${CWP_DESIGN_BASE:-http://localhost:8083/design}
I=${CWP_IDENTITY_BASE:-http://localhost:8082/identity}
pass=0; fail=0
check() { if [ "$2" == "$3" ]; then echo "PASS $1"; pass=$((pass+1)); else echo "FAIL $1 (expected $3, got $2)"; fail=$((fail+1)); fi; }
code() { curl -s -o /tmp/cwp_body -w '%{http_code}' "$@"; }
tok() { curl -s -X POST $I/auth/login -H 'Content-Type: application/json' -d "{\"username\":\"$1\",\"password\":\"$2\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))'; }
j() { python3 -c "import json;print(json.load(open('/tmp/cwp_body'))$1)"; }

check "wrong password -> 401" $(code -X POST $I/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"nope"}') 401
check "no token -> 401" $(code $D/workflows) 401
ADMIN=$(tok admin password); DES=$(tok designer password); APP=$(tok approver password)
[ -n "$DES" ] && check "designer login" ok ok || check "designer login" none ok
H() { echo "Authorization: Bearer $1"; }
KEY=wf_$RANDOM
check "approver cannot create workflow -> 403" $(code -X POST $D/workflows -H "$(H $APP)" -H 'Content-Type: application/json' -d "{\"definitionKey\":\"$KEY\",\"name\":\"x\",\"specType\":\"BPMN\"}") 403
check "designer creates workflow -> 201" $(code -X POST $D/workflows -H "$(H $DES)" -H 'Content-Type: application/json' -d "{\"definitionKey\":\"$KEY\",\"name\":\"Test WF\",\"specType\":\"BPMN\",\"graph\":{\"nodes\":[],\"edges\":[]},\"xmlContent\":\"<x/>\"}") 201
WF=$(j "['workflowId']")
check "duplicate key -> 409" $(code -X POST $D/workflows -H "$(H $DES)" -H 'Content-Type: application/json' -d "{\"definitionKey\":\"$KEY\",\"name\":\"dup\",\"specType\":\"BPMN\"}") 409
check "key-taken true" $(code "$D/workflows/key-taken?key=$KEY" -H "$(H $DES)" >/dev/null; j "['taken']") True
check "save version 2 -> 201" $(code -X POST $D/workflows/$WF/versions -H "$(H $DES)" -H 'Content-Type: application/json' -d '{"graph":{"nodes":[{"id":"n1"}],"edges":[]},"xmlContent":"<v2/>"}') 201
V2=$(j "['versionId']"); check "version number is 2" $(j "['versionNo']") 2
check "load version graph round-trips" $(code $D/versions/$V2 -H "$(H $DES)" >/dev/null; j "['graph']['nodes'][0]['id']") n1
check "submit for approval -> 201" $(code -X POST $D/approvals -H "$(H $DES)" -H 'Content-Type: application/json' -d "{\"workflowId\":\"$WF\",\"versionId\":\"$V2\"}") 201
check "trigger set status pending_approval" $(psql -d cwp -Atc "select status from workflows where id='$WF'") pending_approval
AR=$(psql -d cwp -Atc "select id from approval_requests where workflow_id='$WF'")
check "designer cannot decide -> 403" $(code -X POST $D/approvals/$AR/decision -H "$(H $DES)" -H 'Content-Type: application/json' -d '{"decision":"approved"}') 403
check "approver approves -> 204" $(code -X POST $D/approvals/$AR/decision -H "$(H $APP)" -H 'Content-Type: application/json' -d '{"decision":"approved","comment":"ok"}') 204
check "trigger set status approved" $(psql -d cwp -Atc "select status from workflows where id='$WF'") approved
check "audit actor is the approver" $(psql -d cwp -Atc "select p.username from audit_logs a join app_auth.users p on p.id=a.actor_id where a.entity_id='$AR'") approver
check "designer cannot read audit -> 403" $(code $D/audit -H "$(H $DES)") 403
check "admin reads audit -> 200" $(code $D/audit -H "$(H $ADMIN)") 200
NEWU=u_$RANDOM
check "designer cannot create users -> 403" $(code -X POST $I/members -H "$(H $DES)" -H 'Content-Type: application/json' -d "{\"username\":\"$NEWU\",\"password\":\"password1\",\"role\":\"viewer\"}") 403
check "admin creates user -> 201" $(code -X POST $I/members -H "$(H $ADMIN)" -H 'Content-Type: application/json' -d "{\"username\":\"$NEWU\",\"password\":\"password1\",\"role\":\"viewer\"}") 201
NID=$(j "['id']"); NTOK=$(tok $NEWU password1)
[ -n "$NTOK" ] && check "new user can sign in" ok ok || check "new user can sign in" none ok
check "viewer cannot save versions -> 403" $(code -X POST $D/workflows/$WF/versions -H "$(H $NTOK)" -H 'Content-Type: application/json' -d '{"graph":{}}') 403
check "admin promotes to designer -> 204" $(code -X PUT $I/members/$NID/role -H "$(H $ADMIN)" -H 'Content-Type: application/json' -d '{"role":"designer"}') 204
check "promotion applies to writes at once" $(code -X POST $D/workflows/$WF/versions -H "$(H $NTOK)" -H 'Content-Type: application/json' -d '{"graph":{"nodes":[],"edges":[]}}') 201
check "new version reset approved -> draft" $(psql -d cwp -Atc "select status from workflows where id='$WF'") draft
check "admin deactivates user -> 204" $(code -X PUT $I/members/$NID/status -H "$(H $ADMIN)" -H 'Content-Type: application/json' -d '{"status":"deactivated"}') 204
check "deactivated token cannot write -> 403" $(code -X POST $D/workflows/$WF/versions -H "$(H $NTOK)" -H 'Content-Type: application/json' -d '{"graph":{}}') 403
check "deactivated user cannot sign in -> 403" $(code -X POST $I/auth/login -H 'Content-Type: application/json' -d "{\"username\":\"$NEWU\",\"password\":\"password1\"}") 403
# Tenant isolation: a user in a second tenant sees none of tenant 1's data.
psql -q -d cwp -c "insert into tenants(id,name,slug) values ('00000000-0000-0000-0000-000000000002','Other','other') on conflict do nothing;
 insert into app_auth.users(id,email,username,password_hash) values ('00000000-0000-0000-0000-0000000000b1','other','other',crypt('password',gen_salt('bf'))) on conflict do nothing;
 insert into profiles(id,tenant_id,role,email) values ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-000000000002','tenant_admin','other') on conflict do nothing;"
OTH=$(tok other password)
check "other tenant lists 0 workflows" $(code $D/workflows -H "$(H $OTH)" >/dev/null; j ".__len__()") 0
check "other tenant cannot read version -> 404" $(code $D/versions/$V2 -H "$(H $OTH)") 404
check "other tenant cannot delete -> 404" $(code -X DELETE $D/workflows/$WF -H "$(H $OTH)") 404
check "token claims carry tenant/role" $(echo $DES | cut -d. -f2 | python3 -c 'import sys,base64,json;s=sys.stdin.read().strip();print(json.loads(base64.urlsafe_b64decode(s+"="*(-len(s)%4)))["app_metadata"]["role"])') designer
echo "---- $pass passed, $fail failed"
