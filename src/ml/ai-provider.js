/**
 * AdEclipse AI Provider
 * Multi-provider LLM client supporting OpenAI, Anthropic, OpenRouter, Groq, and custom endpoints
 */

const PROVIDER_PRESETS = {
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Fast, Cheap)', maxTokens: 4096 },
      { id: 'gpt-4o', name: 'GPT-4o (Balanced)', maxTokens: 4096 },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo (Powerful)', maxTokens: 4096 }
    ],
    authType: 'bearer',
    format: 'openai'
  },
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    models: [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4 (Balanced)', maxTokens: 4096 },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku (Fast)', maxTokens: 4096 }
    ],
    authType: 'x-api-key',
    format: 'anthropic'
  },
  openrouter: {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', maxTokens: 4096 },
      { id: 'anthropic/claude-sonnet-4-20250514', name: 'Claude Sonnet 4', maxTokens: 4096 },
      { id: 'google/gemini-2.5-flash-preview', name: 'Gemini 2.5 Flash', maxTokens: 4096 },
      { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', maxTokens: 4096 }
    ],
    authType: 'bearer',
    format: 'openai'
  },
  groq: {
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B (Fast)', maxTokens: 4096 },
      { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', maxTokens: 4096 },
      { id: 'gemma2-9b-it', name: 'Gemma 2 9B', maxTokens: 4096 }
    ],
    authType: 'bearer',
    format: 'openai'
  },
  custom: {
    name: 'Custom (OpenAI-compatible)',
    baseUrl: '',
    models: [],
    authType: 'bearer',
    format: 'openai'
  }
};

class AIProvider {
  constructor() {
    this.config = null;
    this.usageStats = { totalTokens: 0, promptTokens: 0, completionTokens: 0, totalRequests: 0 };
    this.maxRetries = 2;
    this.timeoutMs = 30000;
  }

  configure(settings) {
    const providerKey = settings.provider || 'openai';
    const preset = PROVIDER_PRESETS[providerKey];
    if (!preset) throw new Error(`Unknown provider: ${providerKey}`);

    this.config = {
      providerKey,
      format: preset.format,
      authType: preset.authType,
      apiKey: settings.apiKey || '',
      baseUrl: providerKey === 'custom'
        ? (settings.customBaseUrl || '').replace(/\/+$/, '')
        : preset.baseUrl,
      model: settings.model || preset.models[0]?.id || '',
      maxTokens: 2048
    };
  }

  async sendChatCompletion(messages, options = {}) {
    if (!this.config) throw new Error('Provider not configured. Call configure() first.');
    if (!this.config.apiKey) throw new Error('API key not set.');

    const { format } = this.config;
    let lastError = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          await this._sleep(Math.min(1000 * Math.pow(2, attempt), 8000));
        }

        const response = format === 'anthropic'
          ? await this._sendAnthropic(messages, options)
          : await this._sendOpenAI(messages, options);

        this.usageStats.totalRequests++;
        if (response.usage) {
          this.usageStats.promptTokens += response.usage.promptTokens || 0;
          this.usageStats.completionTokens += response.usage.completionTokens || 0;
          this.usageStats.totalTokens += response.usage.totalTokens || 0;
        }

        return response;
      } catch (error) {
        lastError = error;
        if (error.status === 401 || error.status === 403) throw error;
        if (error.status === 400) throw error;
        if (attempt === this.maxRetries) throw error;
      }
    }

    throw lastError;
  }

  async _sendOpenAI(messages, options) {
    const url = `${this.config.baseUrl}/chat/completions`;
    const body = {
      model: this.config.model,
      messages,
      max_tokens: options.maxTokens || this.config.maxTokens,
      temperature: options.temperature ?? 0.1,
    };

    if (options.responseFormat) {
      body.response_format = options.responseFormat;
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`
    };

    if (this.config.providerKey === 'openrouter') {
      headers['HTTP-Referer'] = 'chrome-extension://adeclipse';
      headers['X-Title'] = 'AdEclipse Ad Blocker';
    }

    const resp = await this._fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      const errorData = await resp.json().catch(() => ({}));
      const error = new Error(errorData.error?.message || `API error: ${resp.status}`);
      error.status = resp.status;
      throw error;
    }

    const data = await resp.json();
    const choice = data.choices?.[0];

    return {
      content: choice?.message?.content || '',
      finishReason: choice?.finish_reason,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens || 0,
        completionTokens: data.usage.completion_tokens || 0,
        totalTokens: data.usage.total_tokens || 0
      } : null
    };
  }

  async _sendAnthropic(messages, options) {
    const url = `${this.config.baseUrl}/messages`;

    const systemMsg = messages.find(m => m.role === 'system');
    const nonSystemMsgs = messages.filter(m => m.role !== 'system');

    const body = {
      model: this.config.model,
      max_tokens: options.maxTokens || this.config.maxTokens,
      messages: nonSystemMsgs.map(m => ({
        role: m.role,
        content: m.content
      }))
    };

    if (systemMsg) {
      body.system = systemMsg.content;
    }

    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey,
      'anthropic-version': '2023-06-01'
    };

    const resp = await this._fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      const errorData = await resp.json().catch(() => ({}));
      const error = new Error(errorData.error?.message || `API error: ${resp.status}`);
      error.status = resp.status;
      throw error;
    }

    const data = await resp.json();
    const textBlock = data.content?.find(b => b.type === 'text');

    return {
      content: textBlock?.text || '',
      finishReason: data.stop_reason,
      usage: data.usage ? {
        promptTokens: data.usage.input_tokens || 0,
        completionTokens: data.usage.output_tokens || 0,
        totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0)
      } : null
    };
  }

  async testConnection() {
    const messages = [
      { role: 'system', content: 'Respond with exactly: {"status":"ok"}' },
      { role: 'user', content: 'ping' }
    ];

    try {
      const response = await this.sendChatCompletion(messages, { maxTokens: 20, temperature: 0 });
      return {
        success: true,
        model: this.config.model,
        provider: this.config.providerKey,
        latencyMs: null,
        message: `Connected to ${PROVIDER_PRESETS[this.config.providerKey]?.name || 'Custom'}`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        status: error.status
      };
    }
  }

  async _fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (error.name === 'AbortError') {
        const timeoutError = new Error(`Request timed out after ${this.timeoutMs}ms`);
        timeoutError.status = 408;
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getUsageStats() {
    return { ...this.usageStats };
  }

  resetUsageStats() {
    this.usageStats = { totalTokens: 0, promptTokens: 0, completionTokens: 0, totalRequests: 0 };
  }

  static getProviders() {
    return Object.entries(PROVIDER_PRESETS).map(([key, preset]) => ({
      id: key,
      name: preset.name,
      models: preset.models
    }));
  }

  static getModelsForProvider(providerKey) {
    return PROVIDER_PRESETS[providerKey]?.models || [];
  }

  static async fetchRemoteModels(providerKey, apiKey) {
    if (!apiKey) return PROVIDER_PRESETS[providerKey]?.models || [];

    if (providerKey === 'openrouter') {
      const resp = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      if (!resp.ok) {
        throw new Error(`Failed to fetch models: ${resp.status}`);
      }
      const data = await resp.json();
      return (data.data || [])
        .map(m => ({
          id: m.id,
          name: m.name || m.id,
          maxTokens: m.context_length || 4096,
          pricing: m.pricing ? {
            prompt: m.pricing.prompt,
            completion: m.pricing.completion
          } : null
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    if (providerKey === 'openai') {
      try {
        const resp = await fetch('https://api.openai.com/v1/models', {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        if (!resp.ok) throw new Error(`${resp.status}`);
        const data = await resp.json();
        const chatModels = (data.data || [])
          .filter(m => m.id.startsWith('gpt-') || m.id.startsWith('o'))
          .map(m => ({ id: m.id, name: m.id, maxTokens: 4096 }))
          .sort((a, b) => a.name.localeCompare(b.name));
        return chatModels.length > 0 ? chatModels : PROVIDER_PRESETS.openai.models;
      } catch (e) {
        return PROVIDER_PRESETS.openai.models;
      }
    }

    if (providerKey === 'groq') {
      try {
        const resp = await fetch('https://api.groq.com/openai/v1/models', {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        if (!resp.ok) throw new Error(`${resp.status}`);
        const data = await resp.json();
        const models = (data.data || [])
          .filter(m => m.active !== false)
          .map(m => ({ id: m.id, name: m.id, maxTokens: m.context_window || 4096 }))
          .sort((a, b) => a.name.localeCompare(b.name));
        return models.length > 0 ? models : PROVIDER_PRESETS.groq.models;
      } catch (e) {
        return PROVIDER_PRESETS.groq.models;
      }
    }

    return PROVIDER_PRESETS[providerKey]?.models || [];
  }
}

export { AIProvider, PROVIDER_PRESETS };
