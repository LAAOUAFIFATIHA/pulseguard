// Turns a 10 s recorder block into the summary stored in the cloud.
// No raw signal (ECG or accelerometer) is ever part of it.

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const round = (x, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

export function summarize(chunk) {
  const rr = chunk.beats.slice(1).map((t, i) => t - chunk.beats[i]).filter((x) => x > 0);
  const m = mean(rr);
  const sd = rr.length > 1 ? Math.sqrt(mean(rr.map((x) => (x - m) ** 2))) : null;
  return {
    seconds: round(chunk.sampleCount / chunk.sampleRate),
    label: chunk.label,
    activity: chunk.activity,
    motion: chunk.motion ?? null,
    beats: chunk.beats.length,
    avgHr: m ? round(60 / m) : null,
    minHr: rr.length ? round(60 / Math.max(...rr)) : null,
    maxHr: rr.length ? round(60 / Math.min(...rr)) : null,
    rrCv: sd == null ? null : round(sd / m, 3),
    avgTempC: round(mean(chunk.tempC ?? []), 2),
    avgHumidity: round(mean(chunk.humidity ?? [])),
    alerts: chunk.alerts.slice(0, 10),
  };
}
