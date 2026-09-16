Component({
  properties: { conflict: { type: Object, value: null } },
  methods: { open() { this.triggerEvent('open', { conflictId: this.data.conflict && this.data.conflict.conflict_id }); } },
});
