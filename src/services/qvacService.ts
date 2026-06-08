// QVAC AI Service integration
// Currently pointing to local LM Studio / OpenAI compatible endpoint at http://127.0.0.1:1234

const USE_QVAC = true; // Set to true to use the local API, false for mock responses

export async function qvacChat(prompt: string): Promise<string> {
  if (!USE_QVAC) {
    return "This is a mock response from Muffin AI. Enable USE_QVAC to use the real model.";
  }

  try {
    const response = await fetch('http://192.168.1.68:1234/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'system',
            content: `You are Muffin AI, a private local finance assistant.
You answer based only on the local financial data provided in the context.
You do not invent balances.
You are concise, helpful and privacy-first.
If a rule is violated, explain it clearly.
If data is stale, mention it.`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        model: 'local-model',
        temperature: 0.7,
        max_tokens: -1,
        stream: false
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('QVAC Error:', err);
      return "I'm sorry, I couldn't connect to my AI brain. Is the local model running on port 1234?";
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();
  } catch (error) {
    console.error('QVAC Chat error:', error);
    return "I'm sorry, there was a problem communicating with the local AI. Please ensure the endpoint is active.";
  }
}
