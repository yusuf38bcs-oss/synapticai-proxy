/**
 * ====================================================================
 * THE SYNAPTIC BRIDGE — PRODUCTION AI EDGE PROXY
 * File: src/index.ts
 * ====================================================================
 */

export interface Env {
  GEMINI_API_KEY: string;
  ALLOWED_ORIGIN: string;
}

const ALLOWED_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash-preview-tts",
  "imagen-3.0-generate-001"
];

export default {

  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {

    const origin = request.headers.get("Origin") || "";

    const CORS_HEADERS = {
      "Access-Control-Allow-Origin":
        env.ALLOWED_ORIGIN || "https://learningbiologyforlife.org",

      "Access-Control-Allow-Methods":
        "POST, OPTIONS, GET",

      "Access-Control-Allow-Headers":
        "Content-Type",

      "Access-Control-Max-Age":
        "86400"
    };

    // =========================================================
    // HEALTH CHECK
    // =========================================================

    const url = new URL(request.url);

    if (request.method === "GET") {

      // favicon fix
      if (url.pathname === "/favicon.ico") {
        return new Response(null, {
          status: 204,
          headers: CORS_HEADERS
        });
      }

      return new Response(
        JSON.stringify({
          status: "ok",
          service: "Synaptic AI Proxy",
          endpoint: "/api/gemini",
          version: "production"
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ...CORS_HEADERS
          }
        }
      );
    }

    // =========================================================
    // CORS PREFLIGHT
    // =========================================================

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: CORS_HEADERS
      });
    }

    // =========================================================
    // STRICT ORIGIN VALIDATION
    // =========================================================

    if (
      env.ALLOWED_ORIGIN !== "*" &&
      origin !== env.ALLOWED_ORIGIN
    ) {

      return new Response(
        JSON.stringify({
          error: "Forbidden Origin"
        }),
        {
          status: 403,
          headers: {
            "Content-Type": "application/json",
            ...CORS_HEADERS
          }
        }
      );
    }

    // =========================================================
    // ONLY POST ALLOWED
    // =========================================================

    if (request.method !== "POST") {

      return new Response(
        JSON.stringify({
          error: "Method not allowed"
        }),
        {
          status: 405,
          headers: {
            "Content-Type": "application/json",
            ...CORS_HEADERS
          }
        }
      );
    }

    // =========================================================
    // API KEY CHECK
    // =========================================================

    if (!env.GEMINI_API_KEY) {

      return new Response(
        JSON.stringify({
          error: "Missing API key"
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            ...CORS_HEADERS
          }
        }
      );
    }

    try {

      // =========================================================
      // SAFE BODY PARSING
      // =========================================================

      let body: any;

      try {
        body = await request.json();
      } catch {
        throw new Error("Invalid JSON body");
      }

      const {
        model,
        type,
        prompt,
        systemInstruction,
        voice
      } = body;

      // =========================================================
      // VALIDATION
      // =========================================================

      if (!model || !prompt) {
        throw new Error("Missing model or prompt");
      }

      if (prompt.length > 20000) {
        throw new Error("Prompt too large");
      }

      if (!ALLOWED_MODELS.includes(model)) {

        return new Response(
          JSON.stringify({
            error: "Unauthorized model"
          }),
          {
            status: 403,
            headers: {
              "Content-Type": "application/json",
              ...CORS_HEADERS
            }
          }
        );
      }

      // =========================================================
      // ROUTING
      // =========================================================

      let endpoint = "generateContent";

      const baseUrl =
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:${endpoint}`;

      let payload: any = {};

      // ---------------------------------------------------------
      // IMAGE GENERATION
      // ---------------------------------------------------------

      if (type === "image") {

        endpoint = "predict";

        payload = {
          instances: [
            {
              prompt
            }
          ],

          parameters: {
            sampleCount: 1
          }
        };

      } else {

        payload = {
          contents: [
            {
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ]
        };

        // system instruction
        if (systemInstruction) {

          payload.systemInstruction = {
            parts: [
              {
                text: systemInstruction
              }
            ]
          };
        }

        // audio
        if (type === "audio") {

          payload.generationConfig = {

            responseModalities: ["AUDIO"],

            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: voice || "Aoede"
                }
              }
            }
          };
        }
      }

      // =========================================================
      // FETCH GOOGLE API
      // =========================================================

      const controller = new AbortController();

      const timeout = setTimeout(() => {
        controller.abort();
      }, 30000);

      const response = await fetch(
        `${baseUrl}?key=${env.GEMINI_API_KEY}`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json"
          },

          body: JSON.stringify(payload),

          signal: controller.signal
        }
      );

      clearTimeout(timeout);

      // =========================================================
      // GOOGLE ERROR HANDLING
      // =========================================================

      if (!response.ok) {

        const errText = await response.text();

        return new Response(
          JSON.stringify({
            error: "Google API Error",
            status: response.status,
            details: errText
          }),
          {
            status: response.status,
            headers: {
              "Content-Type": "application/json",
              ...CORS_HEADERS
            }
          }
        );
      }

      const data: any = await response.json();

      // =========================================================
      // EXTRACT RESPONSE
      // =========================================================

      let result = "";

      if (type === "audio") {

        result =
          data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

      } else if (type === "image") {

        result =
          data?.predictions?.[0]?.bytesBase64Encoded ||
          data?.candidates?.[0]?.content?.parts?.[0]?.text;

      } else {

        result =
          data?.candidates?.[0]?.content?.parts?.[0]?.text;
      }

      if (!result) {
        throw new Error("No AI output received");
      }

      // =========================================================
      // SUCCESS RESPONSE
      // =========================================================

      return new Response(
        JSON.stringify({
          success: true,
          result
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ...CORS_HEADERS
          }
        }
      );

    } catch (error: any) {

      return new Response(
        JSON.stringify({
          success: false,
          error: error.message || "Unknown error"
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            ...CORS_HEADERS
          }
        }
      );
    }
  }
} satisfies ExportedHandler<Env>;
