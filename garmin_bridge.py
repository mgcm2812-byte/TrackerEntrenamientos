"""Small local bridge for python-garminconnect. Passwords are never persisted."""
import json
import math
import os
import sys
from datetime import date


def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def load_garmin():
    try:
        from garminconnect import Garmin
        return Garmin, None
    except Exception:
        return None, "No está instalado python-garminconnect. Instala las dependencias indicadas en requirements-garmin.txt."


def read_message():
    line = sys.stdin.readline()
    if not line:
        return {}
    try:
        return json.loads(line)
    except Exception:
        return {}


def auth(token_dir):
    Garmin, error = load_garmin()
    if error:
        emit({"event": "error", "message": error})
        return 1
    credentials = read_message()
    os.makedirs(token_dir, mode=0o700, exist_ok=True)
    try:
        client = Garmin(credentials.get("email", ""), credentials.get("password", ""), return_on_mfa=True)
        status, client_state = client.login(tokenstore=token_dir)
        if status == "needs_mfa":
            emit({"event": "mfa_required"})
            verification = read_message()
            code = verification.get("mfa", "")
            client.client.resume_login(client_state, code)
        # The wrapper's return_on_mfa path returns before its normal tokenstore
        # persistence code, including when no MFA challenge was needed.
        client.client.dump(token_dir)
        token_file = os.path.join(token_dir, "garmin_tokens.json")
        if not os.path.isfile(token_file):
            raise RuntimeError("Garmin login completed without a saved token file")
        emit({"event": "connected"})
        return 0
    except Exception:
        emit({"event": "error", "message": "Garmin Connect rechazó el inicio de sesión o no pudo completarlo. Revisa los datos, el código y vuelve a intentarlo."})
        return 1


def simplify(row):
    kind = row.get("activityType") or {}
    kind = kind.get("typeKey", "") if isinstance(kind, dict) else str(kind)
    start = row.get("startTimeLocal") or row.get("startTimeGMT") or ""
    day = str(start)[:10]
    if len(day) != 10:
        return None
    try:
        date.fromisoformat(day)
    except ValueError:
        return None
    distance = row.get("distance")
    duration = row.get("duration") or row.get("movingDuration")
    duration_seconds = round(float(duration)) if duration else None
    return {
        "id": str(row.get("activityId", "")),
        "name": row.get("activityName") or "Actividad Garmin",
        "activityType": kind,
        "date": day,
        "distanceKm": round(float(distance) / 1000, 2) if distance else None,
        "durationSeconds": duration_seconds,
        "durationMin": duration_seconds / 60 if duration_seconds is not None else None,
        "avgHeartRate": row.get("averageHR"),
        "maxHeartRate": row.get("maxHR"),
        "elevationGain": row.get("elevationGain"),
    }


def number_from(obj, *keys):
    if not isinstance(obj, dict):
        return None
    for key in keys:
        value = obj.get(key)
        try:
            parsed = float(value)
            if math.isfinite(parsed):
                return parsed
        except (TypeError, ValueError):
            continue
    return None


def safe_call(client, method, activity_id):
    try:
        return getattr(client, method)(activity_id)
    except Exception:
        return None


def safe_json(value):
    if isinstance(value, dict):
        return {str(key): safe_json(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [safe_json(item) for item in value]
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def scalar_summary(row):
    summary = {}
    for key, value in row.items():
        if key == "activityType" and isinstance(value, dict):
            summary[key] = value.get("typeKey")
        elif isinstance(value, (str, int, float, bool)) or value is None:
            if not isinstance(value, str) or len(value) <= 240:
                summary[key] = value
    return safe_json(summary)


def detail_records(details):
    if not isinstance(details, dict):
        return [], 0
    descriptors = details.get("metricDescriptors") or []
    indexes = {}
    for item in descriptors:
        if isinstance(item, dict) and isinstance(item.get("key"), str) and isinstance(item.get("metricsIndex"), int):
            indexes[item["key"]] = item["metricsIndex"]
    samples = details.get("activityDetailMetrics") or []
    if not indexes or not isinstance(samples, list):
        return [], len(samples) if isinstance(samples, list) else 0
    points = []
    stride = max(1, math.ceil(len(samples) / 1800))
    for sample_index, sample in enumerate(samples):
        if sample_index % stride and sample_index != len(samples) - 1:
            continue
        values = sample.get("metrics", []) if isinstance(sample, dict) else []
        raw = {key: values[index] for key, index in indexes.items() if index < len(values)}
        elapsed = number_from(raw, "sumElapsedDuration", "sumDuration", "sumMovingDuration")
        distance_m = number_from(raw, "sumDistance", "directDistance")
        speed_mps = number_from(raw, "directSpeed", "enhancedSpeed")
        altitude_m = number_from(raw, "directAltitude", "enhancedAltitude")
        heart_rate = number_from(raw, "directHeartRate", "directHeartRateEcg")
        power = number_from(raw, "directPower", "directPowerEstimate")
        cadence = number_from(raw, "directRunCadence", "directBikeCadence", "directCadence")
        point = {"elapsed_time": elapsed if elapsed is not None else sample_index, "timer_time": number_from(raw, "sumDuration", "sumMovingDuration") or elapsed}
        if distance_m is not None: point["distance"] = distance_m / 1000
        if speed_mps is not None: point["enhanced_speed"] = speed_mps * 3.6
        if altitude_m is not None: point["altitude"] = altitude_m / 1000
        if heart_rate is not None: point["heart_rate"] = heart_rate
        if power is not None: point["power"] = power
        if cadence is not None: point["cadence"] = cadence
        points.append(point)
    return points, len(samples)


def normalize_laps(value):
    if isinstance(value, dict):
        for key in ("lapDTOs", "splits", "laps", "activitySplits"):
            if isinstance(value.get(key), list):
                value = value[key]
                break
        else:
            value = [value]
    if not isinstance(value, list):
        return []
    laps = []
    for item in value:
        if not isinstance(item, dict):
            continue
        lap = dict(item)
        distance = number_from(item, "total_distance", "distance", "distanceMeters", "totalDistance")
        duration = number_from(item, "total_elapsed_time", "duration", "elapsedDuration", "totalElapsedDuration")
        heart_rate = number_from(item, "avg_heart_rate", "averageHR", "avgHeartRate", "averageHeartRate")
        ascent = number_from(item, "total_ascent", "elevationGain", "totalAscent")
        if distance is not None: lap["total_distance"] = distance / 1000 if distance > 100 else distance
        if duration is not None: lap["total_elapsed_time"] = duration
        if heart_rate is not None: lap["avg_heart_rate"] = heart_rate
        if ascent is not None: lap["total_ascent"] = ascent / 1000 if ascent > 100 else ascent
        laps.append(safe_json(lap))
    return laps


def enrich_activity(client, summary):
    try:
        activity_id = int(summary["id"])
    except (KeyError, TypeError, ValueError):
        return summary
    full = safe_call(client, "get_activity", activity_id)
    merged = {**summary, **(full if isinstance(full, dict) else {})}
    details = safe_call(client, "get_activity_details", activity_id)
    split_data = safe_call(client, "get_activity_splits", activity_id)
    zones = safe_call(client, "get_activity_hr_in_timezones", activity_id)
    records, sample_count = detail_records(details)
    distance_m = number_from(merged, "distance")
    duration = number_from(merged, "duration", "elapsedDuration", "movingDuration")
    moving = number_from(merged, "movingDuration")
    elevation_m = number_from(merged, "elevationGain")
    average_speed = (distance_m / duration * 3.6) if distance_m and duration else number_from(merged, "averageSpeed")
    cadence = number_from(merged, "averageRunningCadenceInStepsPerMinute", "averageRunningCadence", "averageBikeCadence")
    session = {
        "start_time": merged.get("startTimeLocal") or merged.get("startTimeGMT"),
        "sport": merged.get("activityType", {}).get("typeKey") if isinstance(merged.get("activityType"), dict) else merged.get("activityType"),
        "total_elapsed_time": number_from(merged, "elapsedDuration") or duration,
        "total_timer_time": moving or duration,
        "total_distance": distance_m / 1000 if distance_m else None,
        "avg_speed": average_speed,
        "avg_heart_rate": number_from(merged, "averageHR"),
        "max_heart_rate": number_from(merged, "maxHR"),
        "total_calories": number_from(merged, "calories", "activeCalories"),
        "total_ascent": elevation_m / 1000 if elevation_m is not None else None,
        "avg_cadence": cadence,
        "avg_power": number_from(merged, "averagePower"),
        "avg_temperature": number_from(merged, "averageTemperature", "avgTemperature"),
        "max_temperature": number_from(merged, "maxTemperature"),
        "min_temperature": number_from(merged, "minTemperature"),
        "total_steps": number_from(merged, "steps"),
        "avg_respiration_rate": number_from(merged, "averageRespirationRate", "avgRespirationRate"),
        "aerobic_training_effect": number_from(merged, "aerobicTrainingEffect"),
        "anaerobic_training_effect": number_from(merged, "anaerobicTrainingEffect"),
        "vo2_max": number_from(merged, "vO2MaxValue", "vo2MaxValue"),
    }
    summary["durationSeconds"] = round(duration) if duration is not None else summary.get("durationSeconds")
    summary["durationMin"] = summary["durationSeconds"] / 60 if summary.get("durationSeconds") is not None else summary.get("durationMin")
    summary["distanceKm"] = round(distance_m / 1000, 3) if distance_m is not None else summary.get("distanceKm")
    summary["avgHeartRate"] = session["avg_heart_rate"] or summary.get("avgHeartRate")
    summary["maxHeartRate"] = session["max_heart_rate"] or summary.get("maxHeartRate")
    summary["elevationGain"] = elevation_m if elevation_m is not None else summary.get("elevationGain")
    summary["garminDetailsVersion"] = 1
    summary["garminSummary"] = scalar_summary(merged)
    summary["fitData"] = safe_json({
        "sessions": [{key: value for key, value in session.items() if value is not None}],
        "records": records,
        "laps": normalize_laps(split_data),
        "heartRateZones": zones,
        "detailSampleCount": sample_count,
        "detailMetricDescriptors": details.get("metricDescriptors", []) if isinstance(details, dict) else [],
    })
    return summary


def activities(token_dir):
    Garmin, error = load_garmin()
    if error:
        emit({"error": error})
        return 1
    args = read_message()
    try:
        client = Garmin()
        client.login(tokenstore=token_dir)
        rows = client.get_activities_by_date(args["from"], args["to"])
        items = [item for row in rows if (item := simplify(row)) and item["id"]]
        wanted = {str(item) for item in args.get("activityIds", [])}
        if wanted:
            items = [enrich_activity(client, item) if item["id"] in wanted else item for item in items]
        emit({"activities": items})
        return 0
    except Exception:
        emit({"error": "No se pudieron recuperar las actividades. Puede que la sesión de Garmin haya caducado; desconecta y vuelve a conectar la cuenta."})
        return 1


def status():
    _, error = load_garmin()
    emit({"installed": error is None, "error": error})
    return 0


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "status"
    if action == "status":
        return status()
    if action == "auth" and len(sys.argv) > 2:
        return auth(sys.argv[2])
    if action == "activities" and len(sys.argv) > 2:
        return activities(sys.argv[2])
    emit({"error": "Operación no reconocida."})
    return 2


if __name__ == "__main__":
    sys.exit(main())
