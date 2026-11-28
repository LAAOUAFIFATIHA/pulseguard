// Steps 5–7 of the Part 1 guide: Firebase AI Logic hybrid inference.
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  InferenceSource,
  Schema,
} from "firebase/ai";
import { app } from "./firebase.js";

export { InferenceSource };

const ai = getAI(app, { backend: new GoogleAIBackend() });

// Cloud model used when an answer does not come from Gemini Nano.
// This is the Firebase SDK's own hybrid default; it must be named explicitly
// as soon as inCloudParams is set, so it is pinned here for all models.
export const CLOUD_MODEL = "gemini-3.5-flash-lite";

// ── Step 7: one model object per job, each with its own routing mode ─────────

// Live coaching text → Gemini Nano when available, cloud otherwise.
export const coachModel = getGenerativeModel(ai, {
  mode: InferenceMode.PREFER_ON_DEVICE,
  inCloudParams: { model: CLOUD_MODEL },
});

// Long report / trends / doctor summary → cloud first, on-device if the cloud
// call fails (e.g. Wi-Fi off and Nano is ready).
export const reportModel = getGenerativeModel(ai, {
  mode: InferenceMode.PREFER_IN_CLOUD,
  inCloudParams: { model: CLOUD_MODEL },
});

// Symptom notes → JSON tags. Same routing as coachModel, plus structured
// output. Cloud and on-device take the schema in different places, so both
// are given.
const SYMPTOM_TAGS = ["chest_pain", "palpitations", "dizziness", "shortness_of_breath", "fatigue", "none"];

const symptomSchema = Schema.object({
  properties: {
    tags: Schema.array({ items: Schema.enumString({ enum: SYMPTOM_TAGS }) }),
    severity: Schema.enumString({ enum: ["low", "medium", "high"] }),
    summary: Schema.string(),
  },
});

const symptomJsonSchema = {
  type: "object",
  properties: {
    tags: { type: "array", items: { type: "string", enum: SYMPTOM_TAGS } },
    severity: { type: "string", enum: ["low", "medium", "high"] },
    summary: { type: "string" },
  },
  required: ["tags", "severity", "summary"],
};

// Private notes: try strictly on-device first. The cloud model is only used
// after the user agrees (see tagSymptoms).
export const privateSymptomModel = getGenerativeModel(ai, {
  mode: InferenceMode.ONLY_ON_DEVICE,
  inCloudParams: { model: CLOUD_MODEL },
  onDeviceParams: {
    promptOptions: { responseConstraint: symptomJsonSchema },
  },
});

export const cloudSymptomModel = getGenerativeModel(ai, {
  mode: InferenceMode.ONLY_IN_CLOUD,
  inCloudParams: {
    model: CLOUD_MODEL,
    generationConfig: { responseMimeType: "application/json", responseSchema: symptomSchema },
  },
});

// ── Step 5: the first hybrid call ───────────────────────────────────────────

/**
 * Run a single-turn prompt, streaming the answer. `onText` receives the text so
 * far. Reports which side answered and how long it took.
 */
export async function run(model, prompt, onText) {
  const started = performance.now();
  const result = await model.generateContentStream(prompt);
  result.response.catch(() => {}); // a failure is reported by the loop below
  let text = "";
  let firstMs = null;
  for await (const chunk of result.stream) {
    const piece = chunk.text();
    if (!piece) continue;
    firstMs ??= performance.now() - started;
    text += piece;
    onText?.(text);
  }
  const response = await result.response;
  return {
    text,
    source: response.inferenceSource, // InferenceSource.ON_DEVICE or IN_CLOUD
    firstMs,
    totalMs: performance.now() - started,
  };
}

/** The guide's `ask(prompt)` — coaching prompt through the hybrid model. */
export const ask = (prompt, onText) => run(coachModel, prompt, onText);

/** Long report, routed cloud-first. */
export const report = (prompt, onText) => run(reportModel, prompt, onText);

const privacyError = (message) => Object.assign(new Error(message), { privacy: true });

/**
 * Free-text symptom note → { tags, severity, summary }, behind a privacy gate:
 * on-device only, and the note leaves the device only if `confirmCloud()`
 * returns true.
 */
export async function tagSymptoms(note, { confirmCloud }) {
  const prompt =
    "Classify this symptom note from a person wearing an ECG T-shirt. " +
    `Use only these tags: ${SYMPTOM_TAGS.join(", ")}. ` +
    "Reply with JSON only.\n\nNote: " + note;
  const parse = (r) => ({ ...r, data: JSON.parse(r.text) });

  if ((await checkDeviceModel()) === "available") {
    try {
      return parse(await run(privateSymptomModel, prompt));
    } catch (err) {
      console.warn("On-device symptom tagging failed", err);
    }
  }
  if (!navigator.onLine) {
    throw privacyError("The on-device model can't process this note and you're offline. Nothing was sent.");
  }
  if (!(await confirmCloud())) {
    throw privacyError("Your note stayed on this device. Nothing was sent to the cloud.");
  }
  return parse(await run(cloudSymptomModel, prompt));
}

// ── Step 6: on-device model ─────────────────────────────────────────────────

/**
 * Downloads / warms up Gemini Nano. Must be called after a user gesture
 * (button click) and before generateContent() for on-device answers.
 */
export function initDeviceModel(onProgress) {
  return coachModel.initializeDeviceModel(onProgress);
}

/**
 * Chrome Prompt API status. Never throws.
 * "available" | "downloadable" | "downloading" | "unavailable" | "unsupported"
 * ("unsupported" = no LanguageModel global: not Chrome 139+ desktop, or flag off)
 */
export async function checkDeviceModel() {
  try {
    if (typeof LanguageModel === "undefined") return "unsupported";
    return await LanguageModel.availability({
      expectedOutputs: [{ type: "text", languages: ["en"] }],
    });
  } catch {
    return "unsupported";
  }
}

// ── Run planner (Part F): strict JSON segments ─────────────────────────────
import { PLAN_JSON_SCHEMA, SEGMENT_TYPES } from "./runplan.js";
const planSchema = Schema.object({
  properties: {
    title: Schema.string(),
    segments: Schema.array({
      items: Schema.object({
        properties: {
          type: Schema.enumString({ enum: SEGMENT_TYPES }),
          startMinute: Schema.number(),
          durationSec: Schema.integer(),
          targetZone: Schema.integer(),
          paceHint: Schema.string(),
          note: Schema.string(),
        },
      }),
    }),
  },
});
export const planModel = getGenerativeModel(ai, {
  mode: InferenceMode.PREFER_IN_CLOUD,
  inCloudParams: { model: CLOUD_MODEL, generationConfig: { responseMimeType: "application/json", responseSchema: planSchema } },
  onDeviceParams: { promptOptions: { responseConstraint: PLAN_JSON_SCHEMA } },
});
/** Asks the AI for a plan; returns { plan, source } or throws. */
export async function aiPlan(prompt) {
  const res = await run(planModel, prompt);
  const plan = JSON.parse(res.text.replace(/^```(json)?|```$/g, "").trim());
  return { plan, source: res.source };
}
