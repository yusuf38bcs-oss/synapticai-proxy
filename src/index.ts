/**
 * ====================================================================
 * THE SYNAPTIC BRIDGE: AI MIDDLEWARE PROXY (STAGE 3 HARDENED)
 * File: src/index.ts
 * Description: Secure edge proxy with strict CORS validation, 
 * model whitelisting, and unified Google AI Studio routing.
 * ====================================================================
 */

export interface Env {
  GEMINI_API_KEY: string;
  ALLOWED_ORIGIN: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    
    const CORS_HEADERS = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "https://learningbiologyforlife.org",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // ------------------------------------------------------------------
    // 1. HANDLE CORS PREFLIGHT
    // ------------------------------------------------------------------
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // ------------------------------------------------------------------
    // 2. STRICT ORIGIN VALIDATION (Security Patch)
    // ------------------------------------------------------------------
    const origin = request.headers.get("Origin") || "";
    if (env.ALLOWED_ORIGIN !== "*" && origin !== env.ALLOWED_ORIGIN) {
      return new Response(JSON.stringify({ error: "Forbidden: Unauthorized Origin." }), {
        status: 403,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS }
      });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed. Use POST." }), {
        status: 405,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS }
      });
    }

    if (!env.GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: "API Key not configured." }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS }
      });
    }

    try {
      const body: any = await request.json();
      const { model, type, prompt, systemInstruction, voice } = body;

      if (!model || !prompt) {
        throw new Error("Missing required parameters.");
      }

      // ------------------------------------------------------------------
      // 3. MODEL WHITELIST (Security Patch)
      // ------------------------------------------------------------------
      const allowedModels = [
        "gemini-2.5-flash",
        "gemini-2.5-pro",
        "gemini-2.5-flash-preview-tts",
        "imagen-3.0-generate-001" 
      ];

      if (!allowedModels.includes(model)) {
        return new Response(JSON.stringify({ error: "Forbidden: Unauthorized Model." }), {
          status: 403,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS }
        });
      }

      // ------------------------------------------------------------------
      // 4. API ROUTING & PAYLOAD CONSTRUCTION
      // ------------------------------------------------------------------
      const baseUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:`;
      let endpoint = "generateContent";
      let googlePayload: any = {};

      if (type === "image") {
        endpoint = "predict"; 
        googlePayload = {
          instances: [{ prompt: prompt }],
          parameters: { sampleCount: 1 }
        };
      } else {
        googlePayload = { contents: [{ parts: [{ text: prompt }] }] };
        
        if (systemInstruction) {
          googlePayload.systemInstruction = { parts: [{ text: systemInstruction }] };
        }
        
        if (type === "audio") {
          googlePayload.generationConfig = { 
            responseModalities: ["AUDIO"], 
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice || "Aoede" } } } 
          };
        }
      }

      // ------------------------------------------------------------------
      // 5. EXECUTE FETCH TO GOOGLE AI STUDIO
      // ------------------------------------------------------------------
      const googleResponse = await fetch(`${baseUrl}${endpoint}?key=${env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(googlePayload)
      });

      if (!googleResponse.ok) {
        const errorText = await googleResponse.text();
        throw new Error(`Google API Error (${googleResponse.status}): ${errorText}`);
      }

      const data: any = await googleResponse.json();

      // ------------------------------------------------------------------
      // 6. RESPONSE EXTRACTION
      // ------------------------------------------------------------------
      let extractedResult = "";
      
      if (type === "image") {
        extractedResult = data.predictions?.[0]?.bytesBase64Encoded || data.candidates?.[0]?.content?.parts?.[0]?.text;
      } else if (type === "audio") {
        extractedResult = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      } else {
        extractedResult = data.candidates?.[0]?.content?.parts?.[0]?.text;
      }

      if (!extractedResult) {
        throw new Error("Failed to extract content from Google response.");
      }

      return new Response(JSON.stringify({ result: extractedResult }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS }
      });

    } catch (error: any) {
      return new Response(JSON.stringify({ error: true, message: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS }
      });
    }
  }
} satisfies ExportedHandler<Env>;