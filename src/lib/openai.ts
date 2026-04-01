import OpenAI from "openai";

let client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY || process.env.openai;
    if (!apiKey) {
      throw new Error("OpenAI API key not configured. Set OPENAI_API_KEY or openai environment variable.");
    }
    client = new OpenAI({ apiKey });
  }
  return client;
}
