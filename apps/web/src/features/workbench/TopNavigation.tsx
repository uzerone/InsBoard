import { useI18n } from "../../shared/i18n";

function BrandName() {
  return (
    <p className="brand-name" title="InsBoard">
      InsBoard
    </p>
  );
}

export function TopNavigation({
  onOpenProviderConfig,
  isSettingsOpen,
  projectFiles
}: {
  onOpenProviderConfig: () => void;
  isSettingsOpen: boolean;
  projectFiles: React.ReactNode;
}) {
  const { t } = useI18n();

  return (
    <header className="top-navigation">
      <div className="top-navigation__inner">
        <div className="top-navigation__leading">
          <div className="brand-lockup min-w-0">
            <BrandName />
          </div>
          {projectFiles}
        </div>
        <div className="top-navigation__actions">
          <button
            aria-expanded={isSettingsOpen}
            aria-label={t("navOpenProviderConfig")}
            className="top-navigation__settings"
            data-active={isSettingsOpen}
            data-testid="global-provider-settings"
            title={t("navProviderConfig")}
            type="button"
            onClick={onOpenProviderConfig}
          >
            <span>{t("navSettings")}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
