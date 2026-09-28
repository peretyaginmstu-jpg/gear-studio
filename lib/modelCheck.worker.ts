import { checkModelParams } from './modelCheck';
import type { ModelParams } from './model';

self.onmessage = (event: MessageEvent<{ id: number; params: ModelParams }>) => {
  self.postMessage({ id: event.data.id, error: checkModelParams(event.data.params) });
};
