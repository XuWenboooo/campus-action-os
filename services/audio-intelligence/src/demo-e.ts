import type { AudioEvidence, TranscriptSegment } from './types.js';

export const GOLDEN_DEMO_E_TEXT =
  '实验报告周三之前交学习通。\n第二组同学把数据表一起上传。\n哦，刚才截止时间说错了，改成周五晚上八点。';

export type GoldenDemoEExpectation = {
  action: '提交实验报告';
  deadline: '周五 20:00';
  platform: '学习通';
  condition: '第二组额外提交数据表';
  revision: '周三 → 周五 20:00';
};

export const GOLDEN_DEMO_E_EXPECTATION: GoldenDemoEExpectation = {
  action: '提交实验报告',
  deadline: '周五 20:00',
  platform: '学习通',
  condition: '第二组额外提交数据表',
  revision: '周三 → 周五 20:00',
};

export function demoEvidence(
  audioId: string,
  rawAudioHash: string,
  segments: Array<{ segment_id: string; start_ms: number; end_ms: number }>,
): AudioEvidence[] {
  const texts = GOLDEN_DEMO_E_TEXT.split('\n');
  return segments.slice(0, texts.length).map((segment, index) => ({
    evidence_id: `${audioId}:evidence:${segment.segment_id}`,
    source_type: 'audio',
    audio_id: audioId,
    start_ms: segment.start_ms,
    end_ms: segment.end_ms,
    transcript_text: texts[index],
    asr_provider: 'demo-scripted-not-asr',
    confidence: 1,
    raw_audio_hash: rawAudioHash,
  }));
}

export function demoTranscriptSegments(audioId: string): TranscriptSegment[] {
  return GOLDEN_DEMO_E_TEXT.split('\n').map((text, index) => ({
    segment_id: `seg-${String(index + 1).padStart(4, '0')}`,
    start_ms: index * 2_000,
    end_ms: index * 2_000 + 1_800,
    text,
    confidence: 1,
    provider: 'demo-scripted-not-asr',
    source_audio_id: audioId,
  }));
}
