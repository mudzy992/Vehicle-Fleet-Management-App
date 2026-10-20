/**
 * `@vfm/form-renderer` — headless renderer formi (Faza 2).
 *
 * Paket ne sadrži komponente: web (`apps/web`) i mobilna (Faza 6) crtaju svoje
 * kontrole nad **istim** render modelom, pa je paritet po konstrukciji, a ne
 * stvar discipline. Sve odluke (vidljivost, opcije, izračunata polja, greške)
 * donosi `buildRenderModel()` u `@vfm/form-engine` semantici.
 */
export { RENDER_WIDGETS, buildRenderModel, collectSubmitValues, formatFieldValue } from './render-model.js';
export type {
  BuildRenderModelOptions,
  FieldErrorInput,
  RenderField,
  RenderFieldError,
  RenderModel,
  RenderOption,
  RenderProgress,
  RenderSection,
  RenderWidget,
} from './render-model.js';
