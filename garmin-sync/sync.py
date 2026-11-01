#!/usr/bin/env python3
"""Garmin Connect → encrypted JSON for the «Тренер» app.

Runs in GitHub Actions (see .github/workflows/garmin-sync.yml) or locally:

    GARMIN_SYNC_PASSPHRASE=... GARMIN_TOKENS='{"di_token": ...}' python sync.py --out out/

Inputs (environment):
  GARMIN_SYNC_PASSPHRASE  required — the same password the app uses
  GARMIN_AUTH_REQUEST     encrypted login request sent by the app (login with e-mail/password,
                          or the 2FA code), see the "Вход в Garmin" screen of the app
  GARMIN_TOKENS           alternative: tokens from login.py
  GARMIN_EMAIL / GARMIN_PASSWORD  alternative: credentials as repository secrets (no 2FA)

Outputs in --out:
  garmin.enc.json  encrypted data the app downloads
  state.enc.json   encrypted refreshed tokens, reused on the next run
  mfa.enc.json     encrypted pending 2FA login (between "login" and "code" requests)
  status.json      plain status the app polls: ok / need_mfa / mfa_failed / need_login / error
"""
from __future__ import annotations

import argparse
import shutil
import base64
import json
import os
import re
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from crypto_box import decrypt_json, encrypt_json

STATE_SUFFIX = "\x00garmin-tokens"
AUTH_SUFFIX = "\x00auth-request"
MFA_SUFFIX = "\x00mfa-state"
MFA_TTL = timedelta(minutes=30)


class NeedMfa(Exception):
    pass


class AuthProblem(Exception):
    def __init__(self, state: str, message: str):
        super().__init__(message)
        self.state = state
        self.message = message


def log(msg: str) -> None:
    print(msg, flush=True)


def dig(obj, *path, default=None):
    for p in path:
        if obj is None:
            return default
        if isinstance(p, int):
            obj = obj[p] if isinstance(obj, list) and len(obj) > p else None
        else:
            obj = obj.get(p) if isinstance(obj, dict) else None
    return default if obj is None else obj


def num(v, digits=None):
    if isinstance(v, bool) or v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if digits is None:
        return int(round(f))
    return round(f, digits)


def safe(label, fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except Exception as e:  # one failing endpoint must not break the whole sync
        log(f"  ! {label}: {type(e).__name__}: {str(e)[:160]}")
        return None


def clean(d: dict) -> dict:
    return {k: v for k, v in d.items() if v is not None and v != [] and v != ""}


# ───────────────────────── auth ─────────────────────────

def load_tokens(state_file: Path | None, passphrase: str) -> str | None:
    if state_file and state_file.exists():
        try:
            tokens = decrypt_json(json.loads(state_file.read_text()), passphrase + STATE_SUFFIX)
            log("Токены взяты из прошлой синхронизации")
            return json.dumps(tokens)
        except Exception as e:
            log(f"  ! не удалось прочитать сохранённые токены: {e}")
    raw = os.environ.get("GARMIN_TOKENS", "").strip()
    if not raw:
        return None
    if not raw.startswith("{"):
        try:
            raw = base64.b64decode(raw).decode("utf-8")
        except Exception:
            pass
    return raw


def load_auth_request(passphrase: str) -> dict | None:
    raw = os.environ.get("GARMIN_AUTH_REQUEST", "").strip()
    if not raw:
        return None
    try:
        env = json.loads(base64.b64decode(raw).decode("utf-8"))
        req = decrypt_json(env, passphrase + AUTH_SUFFIX)
    except Exception:
        raise AuthProblem("error", "Не удалось расшифровать запрос входа: пароль синхронизации в приложении не совпадает с секретом GARMIN_SYNC_PASSPHRASE.")
    if req.get("action") not in ("login", "mfa"):
        raise AuthProblem("error", "Неизвестный запрос входа.")
    return req


def describe_login_error(e: Exception) -> AuthProblem:
    from garminconnect import GarminConnectAuthenticationError, GarminConnectTooManyRequestsError

    if isinstance(e, GarminConnectTooManyRequestsError):
        return AuthProblem("error", "Garmin временно ограничил попытки входа. Подождите 15–30 минут и попробуйте снова.")
    if isinstance(e, GarminConnectAuthenticationError):
        return AuthProblem("need_login", "Garmin не принял почту или пароль. Проверьте их и войдите снова.")
    return AuthProblem("error", f"Не удалось войти в Garmin: {type(e).__name__}: {str(e)[:200]}")


def authenticate(auth_req: dict | None, prev_dir: Path | None, out_dir: Path, passphrase: str):
    from garminconnect import Garmin

    if auth_req and auth_req["action"] == "login":
        email, password = auth_req.get("email", "").strip(), auth_req.get("password", "")
        if not email or not password:
            raise AuthProblem("need_login", "Не указаны почта или пароль Garmin.")
        g = Garmin(email=email, password=password, return_on_mfa=True)
        try:
            status, state = g.login()
        except Exception as e:  # noqa: BLE001
            raise describe_login_error(e) from e
        if status == "needs_mfa":
            env = encrypt_json({"state": state, "requestId": auth_req.get("requestId")}, passphrase + MFA_SUFFIX)
            (out_dir / "mfa.enc.json").write_text(json.dumps(env))
            raise NeedMfa()
        return g

    if auth_req and auth_req["action"] == "mfa":
        mfa_file = prev_dir / "mfa.enc.json" if prev_dir else None
        if not mfa_file or not mfa_file.exists():
            raise AuthProblem("need_login", "Ожидающий вход не найден — начните вход в Garmin заново.")
        env = json.loads(mfa_file.read_text())
        if datetime.now(timezone.utc) - datetime.fromisoformat(env["updatedAt"]) > MFA_TTL:
            raise AuthProblem("need_login", "Код подтверждения устарел — начните вход в Garmin заново.")
        pending = decrypt_json(env, passphrase + MFA_SUFFIX)
        g = Garmin()
        try:
            g.resume_login(pending["state"], str(auth_req.get("code", "")).strip())
        except Exception as e:  # noqa: BLE001
            # keep the pending login so the user can retry the code
            shutil.copy(mfa_file, out_dir / "mfa.enc.json")
            raise AuthProblem("mfa_failed", "Garmin не принял код. Проверьте его и попробуйте ещё раз или начните вход заново.") from e
        return g

    tokens = load_tokens(prev_dir / "state.enc.json" if prev_dir else None, passphrase)
    email = os.environ.get("GARMIN_EMAIL") or None
    password = os.environ.get("GARMIN_PASSWORD") or None
    if not tokens and not (email and password):
        raise AuthProblem("need_login", "Войдите в Garmin в приложении: Профиль → Garmin и пульс → Вход в Garmin.")
    g = Garmin(email=email, password=password)
    try:
        g.login(tokens) if tokens else g.login()
    except Exception as e:  # noqa: BLE001
        raise describe_login_error(e) from e
    return g


def write_status(out_dir: Path, state: str, message: str, request_id: str | None) -> None:
    status = {
        "state": state,
        "message": message,
        "requestId": request_id,
        "runId": os.environ.get("GITHUB_RUN_ID"),
        "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    (out_dir / "status.json").write_text(json.dumps(status, ensure_ascii=False))
    level = "notice" if state in ("ok", "need_mfa") else "warning"
    log(f"::{level}::Garmin: {message}")


# ───────────────────────── daily metrics ─────────────────────────

def status_phrase(v):
    if not isinstance(v, str):
        return None
    return re.sub(r"_\d+$", "", v)


def daily_metrics(g, day: str) -> dict:
    s = safe(f"summary {day}", g.get_user_summary, day) or {}
    sleep = safe(f"sleep {day}", g.get_sleep_data, day) or {}
    hrv = safe(f"hrv {day}", g.get_hrv_data, day) or {}
    ready = safe(f"readiness {day}", g.get_training_readiness, day) or []
    ts = safe(f"training status {day}", g.get_training_status, day) or {}

    sleep_dto = dig(sleep, "dailySleepDTO", default={})
    ready0 = ready[0] if isinstance(ready, list) and ready else (ready if isinstance(ready, dict) else {})
    latest = dig(ts, "mostRecentTrainingStatus", "latestTrainingStatusData", default={})
    device_status = next(iter(latest.values()), {}) if isinstance(latest, dict) and latest else {}
    stress = num(s.get("averageStressLevel"))

    return clean({
        "date": day,
        "restingHR": num(s.get("restingHeartRate")),
        "steps": num(s.get("totalSteps")),
        "activeKcal": num(s.get("activeKilocalories")),
        "stressAvg": stress if stress and stress > 0 else None,
        "bodyBatteryHigh": num(s.get("bodyBatteryHighestValue")),
        "bodyBatteryLow": num(s.get("bodyBatteryLowestValue")),
        "bodyBatteryMorning": num(s.get("bodyBatteryAtWakeTime")),
        "sleepSec": num(sleep_dto.get("sleepTimeSeconds")),
        "deepSleepSec": num(sleep_dto.get("deepSleepSeconds")),
        "remSleepSec": num(sleep_dto.get("remSleepSeconds")),
        "sleepScore": num(dig(sleep_dto, "sleepScores", "overall", "value")),
        "hrvLastNight": num(dig(hrv, "hrvSummary", "lastNightAvg")),
        "hrvWeeklyAvg": num(dig(hrv, "hrvSummary", "weeklyAvg")),
        "hrvStatus": dig(hrv, "hrvSummary", "status"),
        "readinessScore": num(ready0.get("score")) if isinstance(ready0, dict) else None,
        "readinessLevel": ready0.get("level") if isinstance(ready0, dict) else None,
        "trainingStatus": status_phrase(device_status.get("trainingStatusFeedbackPhrase")),
        "acuteLoad": num(dig(device_status, "acuteTrainingLoadDTO", "dailyTrainingLoadAcute")),
        "vo2max": num(dig(ts, "mostRecentVO2Max", "generic", "vo2MaxPreciseValue"), 1)
        or num(dig(ts, "mostRecentVO2Max", "generic", "vo2MaxValue")),
    })


# ───────────────────────── activities ─────────────────────────

def activity_summary(a: dict) -> dict:
    zones = [num(a.get(f"hrTimeInZone_{i}")) or 0 for i in range(1, 6)]
    start_local = (a.get("startTimeLocal") or "").replace(" ", "T")
    start_gmt = a.get("startTimeGMT")
    return clean({
        "id": str(a.get("activityId")),
        "name": a.get("activityName") or "Активность",
        "type": dig(a, "activityType", "typeKey", default="other"),
        "start": start_local,
        "startGMT": (start_gmt.replace(" ", "T") + "Z") if start_gmt else None,
        "durationSec": num(a.get("duration")) or 0,
        "movingSec": num(a.get("movingDuration")),
        "distanceM": num(a.get("distance")),
        "avgHR": num(a.get("averageHR")),
        "maxHR": num(a.get("maxHR")),
        "calories": num(a.get("calories")),
        "avgSpeed": num(a.get("averageSpeed"), 3),
        "maxSpeed": num(a.get("maxSpeed"), 3),
        "avgCadence": num(a.get("averageRunningCadenceInStepsPerMinute") or a.get("averageBikingCadenceInRevPerMinute")),
        "avgPower": num(a.get("avgPower")),
        "elevationGain": num(a.get("elevationGain")),
        "aerobicTE": num(a.get("aerobicTrainingEffect"), 1),
        "anaerobicTE": num(a.get("anaerobicTrainingEffect"), 1),
        "trainingLoad": num(a.get("activityTrainingLoad"), 1),
        "zoneSec": zones if any(zones) else None,
        "source": "garmin-sync",
    })


def activity_series(g, aid: str):
    from garminconnect import parse_activity_detail_metrics

    details = safe(f"details {aid}", g.get_activity_details, aid, 2000, 0)
    if not details:
        return None
    rows = parse_activity_detail_metrics(details)
    out, last_t = [], -999
    for r in rows:
        t = r.get("sumElapsedDuration", r.get("sumDuration"))
        if t is None:
            continue
        t = int(round(float(t)))
        if t - last_t < 5:
            continue
        last_t = t
        hr = num(r.get("directHeartRate"))
        sp = num(r.get("directSpeed"), 2)
        cad = num(r.get("directRunCadence") or r.get("directDoubleCadence") or r.get("directBikeCadence"))
        out.append([t, hr, sp, cad])
    return out or None


def activity_laps(g, aid: str):
    splits = safe(f"splits {aid}", g.get_activity_splits, aid) or {}
    laps = []
    for i, lap in enumerate(splits.get("lapDTOs") or []):
        laps.append(clean({
            "index": i + 1,
            "durationSec": num(lap.get("duration")),
            "distanceM": num(lap.get("distance")),
            "avgHR": num(lap.get("averageHR")),
            "maxHR": num(lap.get("maxHR")),
            "avgSpeed": num(lap.get("averageSpeed"), 3),
            "avgCadence": num(lap.get("averageRunCadence")),
        }))
    return laps or None


def activity_sets(g, aid: str):
    data = safe(f"sets {aid}", g.get_activity_exercise_sets, aid) or {}
    out = []
    for s in data.get("exerciseSets") or []:
        if (s.get("setType") or "").upper() != "ACTIVE":
            continue
        ex = (s.get("exercises") or [{}])[0] or {}
        w = num(s.get("weight"), 2)
        out.append(clean({
            "exercise": ex.get("name"),
            "category": ex.get("category"),
            "reps": num(s.get("repetitionCount")),
            "weightKg": round(w / 1000, 2) if w and w > 500 else w,
            "durationSec": num(s.get("duration")),
            "startTime": s.get("startTime"),
        }))
    return out or None


STRENGTH_TYPES = {"strength_training", "indoor_cardio", "hiit", "fitness_equipment"}


# ───────────────────────── main ─────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="out")
    ap.add_argument("--prev", default=None, help="folder with the previous garmin.enc.json/state.enc.json")
    ap.add_argument("--days", type=int, default=int(os.environ.get("SYNC_DAYS") or 14))
    args = ap.parse_args()

    passphrase = os.environ.get("GARMIN_SYNC_PASSPHRASE", "")
    if len(passphrase) < 8:
        sys.exit("GARMIN_SYNC_PASSPHRASE не задан или короче 8 символов.")

    prev_dir = Path(args.prev) if args.prev else None
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Keep previous files unless this run replaces them.
    for name in ("garmin.enc.json", "state.enc.json"):
        if prev_dir and (prev_dir / name).exists():
            shutil.copy(prev_dir / name, out_dir / name)

    previous = {"daily": [], "activities": []}
    if prev_dir and (prev_dir / "garmin.enc.json").exists():
        try:
            previous = decrypt_json(json.loads((prev_dir / "garmin.enc.json").read_text()), passphrase)
        except Exception as e:
            log(f"  ! прошлые данные не прочитаны (сменился пароль?): {e}")

    request_id = os.environ.get("GARMIN_REQUEST_ID") or None
    try:
        auth_req = load_auth_request(passphrase)
        request_id = request_id or (auth_req.get("requestId") if auth_req else None)
        g = authenticate(auth_req, prev_dir, out_dir, passphrase)
    except NeedMfa:
        write_status(out_dir, "need_mfa", "Garmin отправил код подтверждения (письмо или приложение). Введите его в приложении.", request_id)
        return
    except AuthProblem as p:
        if not request_id and keep_pending_mfa(prev_dir, out_dir):
            log("Ожидается код подтверждения — статус не меняю")
            return
        write_status(out_dir, p.state, p.message, request_id)
        return
    log("Вход в Garmin Connect выполнен")

    today = date.today()
    days = [(today - timedelta(days=i)).isoformat() for i in range(args.days)]
    by_date = {d["date"]: d for d in previous.get("daily", []) if d.get("date")}
    for i, day in enumerate(days):
        # recent days change during the day — always refresh the last 3; older ones only if missing
        if i < 3 or day not in by_date:
            log(f"День {day}")
            by_date[day] = daily_metrics(g, day)
            time.sleep(0.3)
    keep_since = (today - timedelta(days=60)).isoformat()
    daily = sorted((d for d in by_date.values() if d["date"] >= keep_since), key=lambda d: d["date"], reverse=True)

    prev_acts = {a["id"]: a for a in previous.get("activities", []) if a.get("id")}
    raw = safe("activities", g.get_activities, 0, 40) or []
    since = (today - timedelta(days=args.days)).isoformat()
    activities = []
    for a in raw:
        summ = activity_summary(a)
        if summ.get("start", "")[:10] < since:
            continue
        old = prev_acts.get(summ["id"])
        if old and old.get("series") is not None:
            summ.update({k: old[k] for k in ("series", "laps", "sets") if k in old})
        else:
            log(f"Активность {summ['start']} {summ['name']}")
            summ["series"] = activity_series(g, summ["id"])
            summ["laps"] = activity_laps(g, summ["id"])
            if summ.get("type") in STRENGTH_TYPES:
                summ["sets"] = activity_sets(g, summ["id"])
            time.sleep(0.3)
        activities.append(clean(summ))
    # keep older detailed activities for history (60 days)
    ids = {a["id"] for a in activities}
    activities += [a for a in prev_acts.values() if a["id"] not in ids and a.get("start", "")[:10] >= keep_since]
    activities.sort(key=lambda a: a.get("start", ""), reverse=True)

    data = {"updatedAt": datetime.now().astimezone().isoformat(timespec="seconds"), "daily": daily, "activities": activities}
    (out_dir / "garmin.enc.json").write_text(json.dumps(encrypt_json(data, passphrase)))

    try:
        tokens = json.loads(g.client.dumps())
        (out_dir / "state.enc.json").write_text(json.dumps(encrypt_json(tokens, passphrase + STATE_SUFFIX)))
    except Exception as e:
        log(f"  ! токены не сохранены: {e}")

    write_status(out_dir, "ok", f"Синхронизировано: {len(daily)} дн., {len(activities)} активностей.", request_id)
    log(f"Готово: {len(daily)} дней, {len(activities)} активностей")


def keep_pending_mfa(prev_dir: Path | None, out_dir: Path) -> bool:
    """A scheduled run while the user is entering the 2FA code must not cancel that login."""
    if not prev_dir or not (prev_dir / "mfa.enc.json").exists() or not (prev_dir / "status.json").exists():
        return False
    try:
        status = json.loads((prev_dir / "status.json").read_text())
        env = json.loads((prev_dir / "mfa.enc.json").read_text())
        fresh = datetime.now(timezone.utc) - datetime.fromisoformat(env["updatedAt"]) < MFA_TTL
    except Exception:
        return False
    if status.get("state") in ("need_mfa", "mfa_failed") and fresh:
        shutil.copy(prev_dir / "mfa.enc.json", out_dir / "mfa.enc.json")
        shutil.copy(prev_dir / "status.json", out_dir / "status.json")
        return True
    return False


if __name__ == "__main__":
    main()
