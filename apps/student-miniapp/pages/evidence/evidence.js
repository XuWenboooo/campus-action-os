const api = require('../../utils/api');

const labels = {
  target_population: '受众',
  steps: '行动',
  conditions: '条件',
  deadline: '截止时间',
  platform: '平台',
  required_materials: '所需材料',
};

Page({
  data: {
    action: null,
    sourceText: '',
    evidence: [],
    audioEvidence: [],
    audioId: '',
    selected: '',
    error: '',
    audioLoading: false,
  },
  onLoad(options) {
    api
      .getEvidence(options.actionId)
      .then((result) => {
        const evidence = (result.action.evidence || []).map((item) => ({
          ...item,
          label: labels[item.field_name] || item.field_name,
          type: item.field_name,
        }));
        this.setData({
          action: result.action,
          sourceText: result.source_text,
          evidence,
          selected: evidence[0] && evidence[0].evidence_id,
        });
        return api.getAudioEvidence(options.actionId).then((audio) =>
          this.setData({
            audioId: audio.audio_id,
            audioEvidence: audio.audio_evidence || [],
            sourceText:
              result.source_text ||
              (audio.transcript_segments || []).map((item) => item.text).join('\\n'),
          }),
        );
      })
      .catch((error) => {
        if (error && error.error && error.error.code === 'AUDIO_EVIDENCE_NOT_FOUND') return;
        this.setData({ error: '原文证据读取失败。' });
      });
  },
  selectEvidence(event) {
    this.setData({ selected: event.currentTarget.dataset.id });
  },
  playAudio(event) {
    const item = (this.data.audioEvidence || []).find(
      (evidence) => evidence.evidence_id === event.currentTarget.dataset.id,
    );
    if (!item || !this.data.audioId) return;
    this.setData({ audioLoading: true, error: '' });
    api
      .downloadAudioEvidence(this.data.audioId)
      .then((filePath) => {
        if (this.audio) this.audio.destroy();
        this.audio = wx.createInnerAudioContext();
        this.audio.src = filePath;
        this.audio.startTime = item.start_ms / 1000;
        this.audio.onTimeUpdate(() => {
          if (this.audio.currentTime >= item.end_ms / 1000) this.audio.stop();
        });
        this.audio.play();
        this.setData({ audioLoading: false });
      })
      .catch(() => this.setData({ audioLoading: false, error: '语音依据播放失败。' }));
  },
  onUnload() {
    if (this.audio) this.audio.destroy();
  },
});

