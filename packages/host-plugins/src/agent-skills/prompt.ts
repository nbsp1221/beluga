import type { SkillSource } from './discovery.js';

function escapeXml(text: string) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function skillCatalog(skills: readonly SkillSource[], contextWindow: number | undefined) {
  const eligible = skills.filter(({ modelInvocable }) => modelInvocable);
  const byteLimit =
    contextWindow && contextWindow > 0
      ? Math.min(18_000, Math.floor(contextWindow * 0.02) * 4)
      : 8000;
  let entries = eligible.slice(0, 150).map((source) => ({
    source,
    description: Array.from(source.description.replace(/\s+/g, ' ').trim()).slice(0, 500),
  }));

  function render(descriptionLength: number) {
    if (!entries.length) {
      return '';
    }
    const lines = entries.map(({ source, description }) =>
      descriptionLength
        ? `- ${source.name}: ${escapeXml(description.slice(0, descriptionLength).join(''))}`
        : `- ${source.name}`,
    );
    const omitted = eligible.length - entries.length;
    return [
      '<available_skills>',
      'Use skill({name}) to load relevant instructions by listed name.',
      ...lines,
      ...(omitted ? [`${omitted} skills omitted from this list.`] : []),
      '</available_skills>',
    ].join('\n');
  }

  let text = render(500);
  if (Buffer.byteLength(text) > byteLimit) {
    while (Buffer.byteLength(render(0)) > byteLimit) {
      entries = entries.slice(0, -1);
    }
    let low = 0;
    let high = 220;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (Buffer.byteLength(render(middle)) <= byteLimit) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    text = render(low);
  }

  return { text, entries: entries.map(({ source }) => source) };
}

export function skillBodyLimit(contextWindow: number | undefined, restoring = false) {
  if (!contextWindow || contextWindow <= 0) {
    return 5000;
  }
  return Math.min(restoring ? 25_000 : 5000, Math.floor(contextWindow / 4));
}

export function skillBodyTokens(body: string, name: string) {
  return Math.ceil(
    Buffer.byteLength(
      escapeXml(body) +
        `<system-reminder type="skill-invocation" name="${name}"></system-reminder>`,
    ) / 4,
  );
}
