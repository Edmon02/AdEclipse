/**
 * Tests for AIProvider - Multi-provider LLM client
 */

const { AIProvider, PROVIDER_PRESETS } = require('../../src/ml/ai-provider.js');

describe('AIProvider', () => {
  let provider;

  beforeEach(() => {
    provider = new AIProvider();
    provider._sleep = () => Promise.resolve();
    global.fetch = jest.fn();
  });

  describe('static methods', () => {
    test('getProviders returns all provider presets', () => {
      const providers = AIProvider.getProviders();
      expect(providers).toHaveLength(5);
      expect(providers.map(p => p.id)).toEqual(['openai', 'anthropic', 'openrouter', 'groq', 'custom']);
    });

    test('getModelsForProvider returns correct models', () => {
      const openaiModels = AIProvider.getModelsForProvider('openai');
      expect(openaiModels.length).toBeGreaterThan(0);
      expect(openaiModels[0]).toHaveProperty('id');
      expect(openaiModels[0]).toHaveProperty('name');
    });

    test('getModelsForProvider returns empty for unknown provider', () => {
      expect(AIProvider.getModelsForProvider('nonexistent')).toEqual([]);
    });
  });

  describe('configure', () => {
    test('configures with OpenAI settings', () => {
      provider.configure({ provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o-mini' });
      expect(provider.config.providerKey).toBe('openai');
      expect(provider.config.baseUrl).toBe('https://api.openai.com/v1');
      expect(provider.config.format).toBe('openai');
      expect(provider.config.apiKey).toBe('sk-test');
    });

    test('configures with Anthropic settings', () => {
      provider.configure({ provider: 'anthropic', apiKey: 'ant-test', model: 'claude-sonnet-4-20250514' });
      expect(provider.config.format).toBe('anthropic');
      expect(provider.config.authType).toBe('x-api-key');
    });

    test('configures with custom provider URL', () => {
      provider.configure({
        provider: 'custom',
        apiKey: 'test-key',
        customBaseUrl: 'https://my-server.com/v1/'
      });
      expect(provider.config.baseUrl).toBe('https://my-server.com/v1');
    });

    test('throws on unknown provider', () => {
      expect(() => provider.configure({ provider: 'unknown' })).toThrow('Unknown provider');
    });
  });

  describe('sendChatCompletion - OpenAI format', () => {
    beforeEach(() => {
      provider.configure({ provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o-mini' });
    });

    test('sends correct request format', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'test response' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
        })
      });

      const messages = [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' }
      ];

      const result = await provider.sendChatCompletion(messages);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body)).toMatchObject({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.1
      });
      expect(options.headers['Authorization']).toBe('Bearer sk-test');
      expect(result.content).toBe('test response');
      expect(result.usage.totalTokens).toBe(15);
    });

    test('tracks usage statistics', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
        })
      });

      await provider.sendChatCompletion([{ role: 'user', content: 'test' }]);

      const stats = provider.getUsageStats();
      expect(stats.totalRequests).toBe(1);
      expect(stats.totalTokens).toBe(150);
      expect(stats.promptTokens).toBe(100);
      expect(stats.completionTokens).toBe(50);
    });

    test('throws on 401 without retry', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: { message: 'Invalid API key' } })
      });

      await expect(
        provider.sendChatCompletion([{ role: 'user', content: 'test' }])
      ).rejects.toThrow('Invalid API key');

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('retries on server errors', async () => {
      global.fetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: { message: 'Server error' } })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            choices: [{ message: { content: 'success' } }],
            usage: { total_tokens: 10 }
          })
        });

      const result = await provider.sendChatCompletion([{ role: 'user', content: 'test' }]);
      expect(result.content).toBe('success');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('throws after max retries', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: { message: 'Server error' } })
      });

      await expect(
        provider.sendChatCompletion([{ role: 'user', content: 'test' }])
      ).rejects.toThrow('Server error');

      expect(global.fetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('sendChatCompletion - Anthropic format', () => {
    beforeEach(() => {
      provider.configure({ provider: 'anthropic', apiKey: 'ant-test', model: 'claude-sonnet-4-20250514' });
    });

    test('sends correct Anthropic request format', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'anthropic response' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 20, output_tokens: 10 }
        })
      });

      const messages = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Hello' }
      ];

      const result = await provider.sendChatCompletion(messages);

      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      const body = JSON.parse(options.body);
      expect(body.system).toBe('System prompt');
      expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
      expect(options.headers['x-api-key']).toBe('ant-test');
      expect(options.headers['anthropic-version']).toBe('2023-06-01');
      expect(result.content).toBe('anthropic response');
      expect(result.usage.totalTokens).toBe(30);
    });
  });

  describe('testConnection', () => {
    test('returns success on valid response', async () => {
      provider.configure({ provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o-mini' });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '{"status":"ok"}' } }],
          usage: { total_tokens: 5 }
        })
      });

      const result = await provider.testConnection();
      expect(result.success).toBe(true);
      expect(result.provider).toBe('openai');
    });

    test('returns failure on error', async () => {
      provider.configure({ provider: 'openai', apiKey: 'bad-key', model: 'gpt-4o-mini' });

      global.fetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: { message: 'Invalid key' } })
      });

      const result = await provider.testConnection();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid key');
    });
  });

  describe('sendChatCompletion - no config', () => {
    test('throws when not configured', async () => {
      await expect(
        provider.sendChatCompletion([{ role: 'user', content: 'test' }])
      ).rejects.toThrow('Provider not configured');
    });

    test('throws when no API key', async () => {
      provider.configure({ provider: 'openai', apiKey: '', model: 'gpt-4o-mini' });
      await expect(
        provider.sendChatCompletion([{ role: 'user', content: 'test' }])
      ).rejects.toThrow('API key not set');
    });
  });

  describe('usage tracking', () => {
    test('resetUsageStats clears all counters', () => {
      provider.usageStats = { totalTokens: 100, promptTokens: 60, completionTokens: 40, totalRequests: 5 };
      provider.resetUsageStats();
      expect(provider.getUsageStats()).toEqual({
        totalTokens: 0, promptTokens: 0, completionTokens: 0, totalRequests: 0
      });
    });
  });
});
