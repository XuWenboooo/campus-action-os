Component({
  properties: { suggestion: { type: Object, value: null } },
  methods: { open() { this.triggerEvent('open', { actionId: this.data.suggestion && this.data.suggestion.action_id }); } },
});
