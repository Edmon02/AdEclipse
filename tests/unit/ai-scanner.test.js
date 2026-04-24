/**
 * Tests for AI Scanner content script utilities
 * Tests the prompt templates module (since the scanner IIFE is harder to unit test directly)
 */

const { SYSTEM_PROMPT, buildUserPrompt, buildMessages, FEW_SHOT_EXAMPLES } = require('../../src/ml/prompt-templates.js');

describe('Prompt Templates', () => {
  describe('SYSTEM_PROMPT', () => {
    test('contains ad detection instructions', () => {
      expect(SYSTEM_PROMPT).toContain('ad detection');
      expect(SYSTEM_PROMPT).toContain('What Counts as an Ad');
      expect(SYSTEM_PROMPT).toContain('What is NOT an Ad');
      expect(SYSTEM_PROMPT).toContain('Response Format');
    });

    test('specifies JSON response format', () => {
      expect(SYSTEM_PROMPT).toContain('JSON array');
      expect(SYSTEM_PROMPT).toContain('isAd');
      expect(SYSTEM_PROMPT).toContain('confidence');
      expect(SYSTEM_PROMPT).toContain('adType');
    });
  });

  describe('buildUserPrompt', () => {
    test('includes domain', () => {
      const prompt = buildUserPrompt('example.com', []);
      expect(prompt).toContain('example.com');
    });

    test('includes element count', () => {
      const elements = [{ id: 'el_0', tag: 'div' }, { id: 'el_1', tag: 'span' }];
      const prompt = buildUserPrompt('test.com', elements);
      expect(prompt).toContain('2 total');
    });

    test('formats element metadata', () => {
      const elements = [{
        id: 'el_0',
        tag: 'div',
        classes: ['ad-container', 'banner'],
        text: 'Advertisement',
        width: 728,
        height: 90,
        position: 'top',
        hasIframe: true,
        linkCount: 3,
        externalLinkCount: 2,
        dataAttributes: ['data-ad-slot=12345']
      }];

      const prompt = buildUserPrompt('news.com', elements);

      expect(prompt).toContain('[Element el_0]');
      expect(prompt).toContain('Tag: <div>');
      expect(prompt).toContain('ad-container');
      expect(prompt).toContain('Advertisement');
      expect(prompt).toContain('728x90');
      expect(prompt).toContain('iframe');
      expect(prompt).toContain('Links: 3');
      expect(prompt).toContain('data-ad-slot');
    });

    test('includes optional fields only when present', () => {
      const elements = [{
        id: 'el_0',
        tag: 'div',
        width: 300,
        height: 250
      }];

      const prompt = buildUserPrompt('test.com', elements);
      expect(prompt).toContain('300x250');
      expect(prompt).not.toContain('iframe');
      expect(prompt).not.toContain('video');
      expect(prompt).not.toContain('Aria-label');
    });

    test('includes aria and role when present', () => {
      const elements = [{
        id: 'el_0',
        tag: 'div',
        width: 300,
        height: 250,
        ariaLabel: 'Sponsored content',
        role: 'complementary'
      }];

      const prompt = buildUserPrompt('test.com', elements);
      expect(prompt).toContain('Sponsored content');
      expect(prompt).toContain('complementary');
    });
  });

  describe('buildMessages', () => {
    test('creates system + user messages', () => {
      const messages = buildMessages('test.com', [{ id: 'el_0', tag: 'div', width: 100, height: 100 }], false);
      expect(messages[0].role).toBe('system');
      expect(messages[1].role).toBe('user');
      expect(messages).toHaveLength(2);
    });

    test('includes few-shot examples when requested', () => {
      const messages = buildMessages('test.com', [{ id: 'el_0', tag: 'div', width: 100, height: 100 }], true);
      expect(messages.length).toBeGreaterThan(2);
      const hasAssistant = messages.some(m => m.role === 'assistant');
      expect(hasAssistant).toBe(true);
    });
  });

  describe('FEW_SHOT_EXAMPLES', () => {
    test('contains valid user-assistant pairs', () => {
      expect(FEW_SHOT_EXAMPLES).toHaveLength(2);
      expect(FEW_SHOT_EXAMPLES[0].role).toBe('user');
      expect(FEW_SHOT_EXAMPLES[1].role).toBe('assistant');
    });

    test('assistant example is valid JSON', () => {
      const parsed = JSON.parse(FEW_SHOT_EXAMPLES[1].content);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0]).toHaveProperty('isAd');
      expect(parsed[0]).toHaveProperty('confidence');
    });
  });
});
