#!/usr/bin/env bash
# End-to-end API smoke test against a running MedCore instance.
BASE="${1:-http://localhost:3101/api}"
PASS=0; FAIL=0
step() { echo; echo "### $1"; }
chk() { # chk <label> <expected> <actual>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  PASS  $1 ($3)";
  else FAIL=$((FAIL+1)); echo "  FAIL  $1 — expected [$2], got [$3]"; fi
}
# jget <dot.path>  — reads JSON on stdin, prints a scalar or a JSON value
jget() {
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);const p=process.argv[1].split('.');let v=j;for(const k of p)v=v===undefined?undefined:v[k];console.log(v===undefined?'UNDEF':(typeof v==='object'?JSON.stringify(v):v))}catch(e){console.log('PARSE_ERR')}})" "$1"
}
ids() { grep -o '"id":"[^"]*"' | cut -d'"' -f4 | tr '\n' ' '; }
# patient rows expose the Patient.id (needed for booking) nested under "patient"
pids() { grep -o '"patient":{"id":"[^"]*"' | cut -d'"' -f6 | tr '\n' ' '; }

step "docs"
chk "swagger available" 200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/docs)"

step "auth"
chk "bad password rejected" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"email":"superadmin@medcore.demo","password":"wrong"}')"
LOGIN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"email":"superadmin@medcore.demo","password":"Passw0rd!123"}')
AT=$(echo "$LOGIN" | jget data.accessToken); RT=$(echo "$LOGIN" | jget data.refreshToken)
chk "platform admin login" 383 "${#AT}"
A="Authorization: Bearer $AT"
chk "whoami" SUPER_ADMIN "$(curl -s -H "$A" $BASE/auth/me | jget data.role)"
chk "garbage token rejected" 401 "$(curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer not.a.token' $BASE/auth/me)"

step "auth: refresh rotation + replay detection"
JAR=$(mktemp); JAR2=$(mktemp)
curl -s -c "$JAR" -o /dev/null -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"email":"superadmin@medcore.demo","password":"Passw0rd!123"}'
chk "refresh cookie set" 1 "$(grep -c 'medcore_rt\|refresh' "$JAR" 2>/dev/null | awk '{print ($1>0)?1:0}')"
cp "$JAR" "$JAR2"
R1=$(curl -s -b "$JAR" -c "$JAR" -X POST $BASE/auth/refresh)
AT2=$(echo "$R1" | jget data.accessToken)
chk "rotation issued new access token" 383 "${#AT2}"
chk "rotated token works" 200 "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $AT2" $BASE/auth/me)"
echo "  replay of consumed cookie -> $(curl -s -b "$JAR2" -X POST $BASE/auth/refresh | head -c 170)"
chk "replay rejected" 401 "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR2" -X POST $BASE/auth/refresh)"
rm -f "$JAR" "$JAR2"
# replay revokes the session family — sign in again for the remaining checks
LOGIN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"email":"superadmin@medcore.demo","password":"Passw0rd!123"}')
AT=$(echo "$LOGIN" | jget data.accessToken); A="Authorization: Bearer $AT"

step "analytics (super admin, cross-tenant)"
for ep in overview revenue appointments departments; do
  chk "analytics/$ep" true "$(curl -s -H "$A" $BASE/analytics/$ep | jget success)"
done
echo "  overview: $(curl -s -H "$A" $BASE/analytics/overview | head -c 240)"

step "tenancy"
chk "hospital list" true "$(curl -s -H "$A" $BASE/hospitals | jget success)"
echo "  hospitals=$(curl -s -H "$A" $BASE/hospitals | jget data.length)"
HOSP=$(curl -s -H "$A" $BASE/hospitals | jget data.0.id)
chk "hospital departments" true "$(curl -s -H "$A" $BASE/hospitals/$HOSP/departments | jget success)"

step "directory + clinical data"
chk "doctors" true "$(curl -s -H "$A" "$BASE/doctors?limit=3" | jget success)"
echo "  doctors=$(curl -s -H "$A" "$BASE/doctors?limit=100" | jget data.length)"
chk "users" true "$(curl -s -H "$A" "$BASE/users?limit=3" | jget success)"
echo "  users=$(curl -s -H "$A" "$BASE/users?limit=200" | jget data.length)  patients=$(curl -s -H "$A" "$BASE/users?role=PATIENT&limit=200" | jget data.length)"
chk "appointments" true "$(curl -s -H "$A" "$BASE/appointments?limit=3" | jget success)"
echo "  appointments=$(curl -s -H "$A" "$BASE/appointments?limit=200" | jget data.length)"
chk "lab tests" true "$(curl -s -H "$A" "$BASE/lab-tests?limit=2" | jget success)"
chk "lab orders" true "$(curl -s -H "$A" "$BASE/lab-orders?limit=2" | jget success)"
echo "  lab orders=$(curl -s -H "$A" "$BASE/lab-orders?limit=100" | jget data.length)"
chk "prescriptions" true "$(curl -s -H "$A" "$BASE/prescriptions?limit=2" | jget success)"
echo "  prescriptions=$(curl -s -H "$A" "$BASE/prescriptions?limit=100" | jget data.length)"
chk "medicines" true "$(curl -s -H "$A" "$BASE/medicines?limit=2" | jget success)"
echo "  medicines=$(curl -s -H "$A" "$BASE/medicines?limit=100" | jget data.length)"
chk "medicine alerts" true "$(curl -s -H "$A" "$BASE/medicines/alerts" | jget success)"
chk "invoices" true "$(curl -s -H "$A" "$BASE/invoices?limit=2" | jget success)"
echo "  invoices=$(curl -s -H "$A" "$BASE/invoices?limit=100" | jget data.length)"
chk "notifications" true "$(curl -s -H "$A" $BASE/notifications/me | jget success)"

step "medical record of a treated patient"
# patients are addressed by Patient.id (from an appointment), not User.id
PID=$(curl -s -H "$A" "$BASE/appointments?limit=1" | jget data.0.patientId)
REC=$(curl -s -H "$A" "$BASE/medical-records/patient/$PID")
chk "record fetch" true "$(echo "$REC" | jget success)"
echo "  records for patient=$(echo "$REC" | jget data.length)"

step "audit trail"
chk "audit log" true "$(curl -s -H "$A" "$BASE/audit?limit=3" | jget success)"
echo "  entries=$(curl -s -H "$A" "$BASE/audit?limit=100" | jget data.length)"

step "RBAC: anonymous gets 401"
for r in appointments users medicines audit analytics/overview doctors; do
  chk "anon $r" 401 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/$r)"
done

step "RBAC: PATIENT role"
USERS=$(curl -s -H "$A" "$BASE/users?role=PATIENT&limit=2")
P1MAIL=$(echo "$USERS" | jget data.0.email); P2MAIL=$(echo "$USERS" | jget data.1.email)
PL1=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$P1MAIL\",\"password\":\"Passw0rd!123\"}")
P1=$(echo "$PL1" | jget data.accessToken)
chk "patient login" 200 "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $P1" $BASE/auth/me)"
chk "patient blocked from audit" 403 "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $P1" $BASE/audit?limit=1)"
chk "patient blocked from user admin" 403 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $P1" -H 'Content-Type: application/json' -d '{"email":"x@y.io","password":"Passw0rd!123","firstName":"X","lastName":"Y","role":"DOCTOR"}' $BASE/users)"
chk "patient blocked from analytics" 403 "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $P1" $BASE/analytics/overview)"
# invoices are visible to patients but must be scoped to their own account
R1=$(curl -s -H "Authorization: Bearer $P1" "$BASE/invoices?limit=100")
I1=$(echo "$R1" | jget data); T1=$(echo "$R1" | jget meta.total)
echo "  patient A sees $T1 invoice(s)"
PL2=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$P2MAIL\",\"password\":\"Passw0rd!123\"}")
P2=$(echo "$PL2" | jget data.accessToken)
R2=$(curl -s -H "Authorization: Bearer $P2" "$BASE/invoices?limit=100")
I2=$(echo "$R2" | jget data); T2=$(echo "$R2" | jget meta.total)
echo "  patient B sees $T2 invoice(s)"
FIRST1=$(echo "$I1" | ids | awk '{print $1}'); FIRST2=$(echo "$I2" | ids | awk '{print $1}')
chk "invoice sets are patient-specific" different "$([ -n "$FIRST1" ] && [ -n "$FIRST2" ] && [ "$FIRST1" != "$FIRST2" ] && echo different || echo same-or-empty)"

step "booking: free-slot lookup + double-booking rejection"
DOC=$(curl -s -H "$A" "$BASE/doctors?limit=1" | jget data.0.id)
FOUND=""
for i in $(seq 1 14); do
  D=$(node -e "const d=new Date();d.setDate(d.getDate()+Number(process.argv[1]));console.log(d.toISOString().slice(0,10))" "$i")
  S=$(curl -s -H "$A" "$BASE/doctors/$DOC/slots?date=$D")
  SLOT=$(echo "$S" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);const arr=j.data||j;const f=(Array.isArray(arr)?arr:[]).find(s=>s.available);console.log(f?f.startTime:'')}catch(e){console.log('')}})")
  if [ -n "$SLOT" ]; then FOUND="$D|$SLOT"; break; fi
done
chk "free slot found" 1 "$([ -n "$FOUND" ] && echo 1 || echo 0)"
BDATE=$(echo "$FOUND" | cut -d'|' -f1); BSTART=$(echo "$FOUND" | cut -d'|' -f2)
echo "  doctor=$DOC date=$BDATE start=$BSTART"

C1=000; USED=""
for P in $(curl -s -H "$A" "$BASE/users?role=PATIENT&limit=10" | jget data | pids); do
  BODY=$(node -e "console.log(JSON.stringify({patientId:process.argv[1],doctorId:process.argv[2],scheduledDate:process.argv[3],startTime:process.argv[4],type:'CONSULTATION',reason:'follow up visit'}))" "$P" "$DOC" "$BDATE" "$BSTART")
  C1=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "$A" -H 'Content-Type: application/json' -d "$BODY" $BASE/appointments)
  if [ "$C1" = "201" ]; then USED="$P"; break; fi
done
chk "first booking accepted" 201 "$C1"

# a different patient going for the same slot must be turned away by the doctor clash rule
OTHER=""
for P in $(curl -s -H "$A" "$BASE/users?role=PATIENT&limit=15" | jget data | pids); do
  [ "$P" != "$USED" ] && { OTHER="$P"; break; }
done
BODY2=$(node -e "console.log(JSON.stringify({patientId:process.argv[1],doctorId:process.argv[2],scheduledDate:process.argv[3],startTime:process.argv[4],type:'CONSULTATION',reason:'same slot again'}))" "$OTHER" "$DOC" "$BDATE" "$BSTART")
echo "  second patient on the same slot -> $(curl -s -X POST -H "$A" -H 'Content-Type: application/json' -d "$BODY2" $BASE/appointments | head -c 170)"
C2=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "$A" -H 'Content-Type: application/json' -d "$BODY2" $BASE/appointments)
chk "duplicate slot rejected" 409 "$C2"

# booking without a patient id must fail validation rather than crash
BODY3=$(node -e "console.log(JSON.stringify({doctorId:process.argv[1],scheduledDate:process.argv[2],startTime:process.argv[3]}))" "$DOC" "$BDATE" "$BSTART")
chk "missing patientId rejected" 400 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "$A" -H 'Content-Type: application/json' -d "$BODY3" $BASE/appointments)"

step "appointment status transition"
AID=$(curl -s -H "$A" "$BASE/appointments?status=CONFIRMED&limit=1" | jget data.0.id)
if [ "$AID" = "UNDEF" ] || [ -z "$AID" ]; then AID=$(curl -s -H "$A" "$BASE/appointments?status=PENDING&limit=1" | jget data.0.id); fi
echo "  appointment=$AID"
chk "cancel appointment" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH -H "$A" -H 'Content-Type: application/json' -d '{"status":"CANCELLED","cancellationReason":"smoke test"}' $BASE/appointments/$AID/status)"

echo; echo "==================================="
echo "PASSED=$PASS  FAILED=$FAIL"
[ "$FAIL" -eq 0 ]
