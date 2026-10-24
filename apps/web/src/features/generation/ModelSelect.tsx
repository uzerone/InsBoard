import { IMAGE_MODELS, isImageModel } from "@insboard/shared";
import { useState } from "react";
import { useI18n } from "../../shared/i18n";

export function ModelSelect({ value, onChange, disabled = false }: {
  value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const { t } = useI18n();
  const custom = !IMAGE_MODELS.some(model => model.id === value);
  const [customDraft, setCustomDraft] = useState(custom ? value : "");
  return <>
    <label><span className="control-label">{t("providerFieldModel")}</span>
      <select className="field-control" data-testid="generation-model" disabled={disabled} value={custom ? "custom" : value}
        onChange={event => onChange(event.target.value === "custom" ? customDraft : event.target.value)}>
        {IMAGE_MODELS.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
        <option value="custom">{t("settingsCustomModel")}</option>
      </select>
    </label>
    {custom && <label><span className="control-label">{t("settingsCustomModelId")}</span>
      <input className="field-control" data-testid="generation-custom-model" disabled={disabled} autoComplete="off" spellCheck={false}
        aria-invalid={!isImageModel(value)} maxLength={200} value={value}
        onChange={event => { setCustomDraft(event.target.value); onChange(event.target.value); }} />
    </label>}
  </>;
}
