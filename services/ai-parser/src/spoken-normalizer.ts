export type SpokenActionCandidate = {
  source_text: string;
  normalized_text: string;
  action_text: string;
  verb: string;
  object_text: string;
  platform: string | null;
  platform_source_text: string | null;
  deadline_text: string | null;
  audience_text: string | null;
  condition_text: string | null;
  obligation_text: string | null;
};

export type SpokenNormalization = {
  raw_text: string;
  normalized_text: string;
  candidates: SpokenActionCandidate[];
};

const obligationPattern = /要|需要|得|必须|记得|别忘了|麻烦|请|务必/u;
const verbPattern =
  /上交|上传|发过去|交给|交钱|交一下|填一下|确认一下|报一下|做完|提交|填写|确认|报名(?!表)|缴费|领取|完成|传|发|交|填|做|拿/u;
const canonicalVerb: Array<[RegExp, string]> = [
  [/缴费|交钱/u, '缴费'],
  [/填写|填一下|填/u, '填写'],
  [/确认一下|确认/u, '确认'],
  [/报名|报一下/u, '报名'],
  [/领取|拿/u, '领取'],
  [/完成|做完|做/u, '完成'],
  [/上传|传/u, '上传'],
  [/发过去|发/u, '发送'],
  [/上交|提交|交给|交一下|交/u, '提交'],
];

function splitSentences(text: string): string[] {
  return text
    .split(/\r?\n|(?<=[。！？；])/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function cleanFiller(value: string): string {
  return value
    .replace(/^(?:哦|嗯|那个|注意一下|大家统一|大家|请大家|麻烦大家)\s*/u, '')
    .replace(/\s+/g, '')
    .trim();
}

function deadlineIn(sentence: string): string | null {
  const match = sentence.match(
    /(?:今天|今晚|今早|明天|后天|(?:本周|这周|下周)[一二三四五六日天]|周[一二三四五六日天])(?:早上|上午|中午|下午|晚上)?(?:\d{1,2}(?::\d{2})?点?(?:\d{1,2}分)?)?/u,
  );
  return match?.[0] ?? null;
}

function platformIn(sentence: string, verbIndex: number, verbText: string): {
  value: string | null;
  source: string | null;
} {
  const afterVerb = sentence.slice(verbIndex + verbText.length);
  const afterMatch = afterVerb.match(
    /^(?:一下)?(?:(?:到|在|至|给))?(学习通|教务系统|班级群|系统|平台|邮箱|班长|老师)(?=[，。；\s]|$)/u,
  );
  if (afterMatch) return { value: afterMatch[1], source: afterMatch[0] };

  const anywhereMatch = sentence.match(
    /(?:到|在|至|给)(学习通|教务系统|班级群|系统|平台|邮箱|班长|老师)(?=[，。；\s]|$)/u,
  );
  if (anywhereMatch) return { value: anywhereMatch[1], source: anywhereMatch[0] };

  const beforeMatch = sentence.match(
    /(教务系统|学习通|班级群|系统|平台|邮箱|班长|老师)(?:里|中)?(?=把|填写|填|确认|报名|提交|上传|交|发)/u,
  );
  if (beforeMatch) return { value: beforeMatch[1], source: beforeMatch[0].trim() };
  return { value: null, source: null };
}

function objectFromSentence(
  sentence: string,
  verbIndex: number,
  verbText: string,
  deadlineText: string | null,
  platform: string | null,
  audienceText: string | null,
): string {
  const before = sentence.slice(0, verbIndex);
  const after = sentence.slice(verbIndex + verbText.length);
  let value: string;
  if (before.includes('把')) value = before.slice(before.lastIndexOf('把') + 1);
  else if (before.includes('还要')) value = after;
  else {
    const obligationMatch = before.match(
      /(?:需要|必须|记得|别忘了|务必|要|得|请|麻烦)(?=在|于|今天|明天|后天|本周|这周|下周|周|把|交|上交|上传|传|发|填写|填|确认|报名|缴费|交钱|完成|做)/u,
    );
    value = obligationMatch ? before.slice(0, obligationMatch.index) : before;
    if (!value.trim()) value = after;
  }
  if (value.includes('把')) value = value.slice(value.lastIndexOf('把') + 1);
  if (audienceText) value = value.replace(audienceText, '');
  if (deadlineText) value = value.replace(deadlineText, '');
  if (platform) value = value.replace(new RegExp(`(?:到|在|至|给)?${platform}`, 'u'), '');
  return value
    .replace(/^(?:请|于|在|要|需要|得|必须|记得|别忘了|麻烦|务必|大家统一|大家)/u, '')
    .replace(/(?:之前|以前|前|截止)$/u, '')
    .replace(/[，。；、\s]/gu, '')
    .trim();
}

function candidateFor(sentence: string): SpokenActionCandidate | null {
  if (/说错|改成|更正|纠正/u.test(sentence)) return null;
  const verbMatch = sentence.match(verbPattern);
  if (!verbMatch || verbMatch.index === undefined) return null;
  const verbIndex = verbMatch.index;
  const verbText = verbMatch[0];
  const deadlineText = deadlineIn(sentence);
  const audienceMatch = sentence.match(/([^，。；]+?)的同学/u);
  const audienceText = audienceMatch?.[0] ?? null;
  const platformResult = platformIn(sentence, verbIndex, verbText);
  const objectText = objectFromSentence(
    sentence,
    verbIndex,
    verbText,
    deadlineText,
    platformResult.value,
    audienceText,
  );
  if (!objectText) return null;
  const canonical = canonicalVerb.find(([pattern]) => pattern.test(verbText))?.[1] ?? verbText;
  const actionText = `${canonical}${objectText}`;
  const obligationText = sentence.match(obligationPattern)?.[0] ?? null;
  const conditionText = audienceText ? `${audienceText}专属要求` : null;
  const normalizedText = [
    audienceText ? `${audienceText}需` : null,
    deadlineText ? `${deadlineText}前` : null,
    actionText,
    platformResult.value ? `到${platformResult.value}` : null,
  ]
    .filter(Boolean)
    .join('');
  return {
    source_text: sentence,
    normalized_text: normalizedText,
    action_text: actionText,
    verb: canonical,
    object_text: objectText,
    platform: platformResult.value,
    platform_source_text: platformResult.source,
    deadline_text: deadlineText,
    audience_text: audienceText,
    condition_text: conditionText,
    obligation_text: obligationText,
  };
}

export function normalizeSpokenText(rawText: string): SpokenNormalization {
  const raw = rawText.replace(/\r\n?/g, '\n').trim();
  const sentences = splitSentences(raw);
  const candidates = sentences
    .map(candidateFor)
    .filter((candidate): candidate is SpokenActionCandidate => candidate !== null);
  const normalizedParts = sentences.map((sentence) => {
    const candidate = candidates.find((item) => item.source_text === sentence);
    return candidate ? `${candidate.normalized_text}。` : cleanFiller(sentence);
  });
  return { raw_text: raw, normalized_text: normalizedParts.join('\n'), candidates };
}
