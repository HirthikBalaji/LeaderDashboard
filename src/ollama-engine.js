/**
 * Ollama Engine — AI Powered curation using local LLMs
 */

export class OllamaEngine {
  constructor(model = "gemma4:latest", host = "http://172.19.140.109:11434") {
    this.model = model;
    this.host = host;
  }

  /**
   * General completion helper
   */
  async generate(prompt, system = "You are a professional Executive Chief of Staff AI.") {
    try {
      const response = await fetch(`${this.host}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          system,
          stream: false,
          options: { temperature: 0.1, num_predict: 500 }
        })
      });

      if (!response.ok) throw new Error(`Ollama error: ${response.statusText}`);
      const data = await response.json();
      return data.response.trim();
    } catch (err) {
      console.error("Ollama Engine Error:", err.message);
      return null;
    }
  }

  /**
   * Curates a list of emails into a strategic dashboard summary
   */
  async curateEmails(emails) {
    if (!emails || emails.length === 0) return "No emails to curate.";

    const emailContext = emails.map((e, i) => 
      `[${i+1}] FROM: ${e.from} | SUBJECT: ${e.subject}\nBODY: ${e.body.slice(0, 300)}`
    ).join("\n\n---\n\n");

    const systemPrompt = `You are a professional Executive Assistant. 
Analyze the provided emails and provide a "Strategic Intelligence Curation".
Categorize items into:
1. 🔥 CRITICAL ACTIONS (Immediate attention)
2. 🏢 INSTITUTIONAL RISKS (Silent escalations)
3. 🤝 KEY OPPORTUNITIES (Growth & Collaboration)

Keep it extremely concise, professional, and bulleted. Use a neat and tidy format.`;

    const prompt = `Here are the latest filtered emails:\n\n${emailContext}\n\nProvide the strategic curation now.`;

    return await this.generate(prompt, systemPrompt);
  }
}
