import {
  ArrowRight,
  CheckCircle2,
  ImageIcon,
  KeyRound,
  Loader2,
  ShieldCheck,
  Sparkles,
  Terminal
} from "lucide-react";
import type { AuthStatusResponse } from "@gpt-image-canvas/shared";
import productPreviewUrl from "../../../../../docs/assets/app-preview.png";
import { useI18n } from "../../shared/i18n";

interface HomePageProps {
  authError: string;
  authStatus: AuthStatusResponse | null;
  isAuthLoading: boolean;
  isCodexStarting: boolean;
  onOpenProviderConfig: () => void;
  onOpenGallery: () => void;
  onStartCodexLogin: () => void;
}

export function HomePage({
  authError,
  authStatus,
  isAuthLoading,
  isCodexStarting,
  onOpenProviderConfig,
  onOpenGallery,
  onStartCodexLogin
}: HomePageProps) {
  const { t } = useI18n();
  const providerLabel =
    authStatus?.provider === "openai" ? t("homeProviderOpenAI") : authStatus?.provider === "codex" ? t("homeProviderCodex") : t("homeProviderNone");
  const proofItems = [
    {
      copy: t("homeStatPromptCopy"),
      title: t("homeStatPromptTitle"),
      value: "01"
    },
    {
      copy: t("homeStatReferenceCopy"),
      title: t("homeStatReferenceTitle"),
      value: "02"
    },
    {
      copy: t("homeStatProviderCopy"),
      title: t("homeStatProviderTitle"),
      value: "03"
    }
  ];
  const workflowSteps = [
    {
      copy: t("homeFlowBriefCopy"),
      title: t("homeFlowBriefTitle"),
      value: "01"
    },
    {
      copy: t("homeFlowReferenceCopy"),
      title: t("homeFlowReferenceTitle"),
      value: "02"
    },
    {
      copy: t("homeFlowAgentCopy"),
      title: t("homeFlowAgentTitle"),
      value: "03"
    },
    {
      copy: t("homeFlowArchiveCopy"),
      title: t("homeFlowArchiveTitle"),
      value: "04"
    }
  ];
  const trustItems = [
    t("homeTrustProvider"),
    t("homeTrustSecret"),
    t("homeTrustRecover"),
    t("homeTrustGallery")
  ];
  const plateSteps = workflowSteps.map((step) => step.title);
  const wireItems = [t("homeWirePrompt"), t("homeWireReference"), t("homeWireProvider"), t("homeWireGallery")];

  return (
    <main className="home-page app-view" data-testid="home-page">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero__copy">
          <p className="home-kicker">
            <Sparkles className="size-4" aria-hidden="true" />
            {t("homeKicker")}
            <span>{t("homePlateTitle")}</span>
          </p>
          <h1 id="home-title">{t("homeTitle")}</h1>
          <p className="home-deck">{t("homeDeck")}</p>

          <div className="home-command-strip" aria-label={t("homeEntryAria")}>
            <div className="home-command-state" data-provider={authStatus?.provider ?? "loading"} data-testid="home-provider-state" role="status">
              <span className="home-command-state__icon">
                {isAuthLoading ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : authStatus?.provider === "none" || !authStatus ? (
                  <KeyRound className="size-4" aria-hidden="true" />
                ) : (
                  <ShieldCheck className="size-4" aria-hidden="true" />
                )}
              </span>
              <span className="home-command-state__copy">{isAuthLoading ? t("homeAuthChecking") : providerLabel}</span>
            </div>
            <div className="home-command-actions">
              <span aria-hidden="true">/</span>
              <button
                className="home-command-action home-command-action--primary"
                data-testid="home-codex-login"
                disabled={isAuthLoading || isCodexStarting}
                type="button"
                onClick={onStartCodexLogin}
              >
                {isCodexStarting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <KeyRound className="size-4" aria-hidden="true" />}
                {t("homeStartCodex")}
              </button>
              <button className="home-command-action" data-testid="home-api-setup" type="button" onClick={onOpenProviderConfig}>
                <Terminal className="size-4" aria-hidden="true" />
                {t("homeApiSetup")}
              </button>
            </div>
          </div>

          {authError ? (
            <p className="home-auth-error" role="alert">
              {authError}
            </p>
          ) : null}

          <ol className="home-proof-line" aria-label={t("homeProofAria")}>
            {proofItems.map((item) => (
              <li className="home-proof-line__item" key={item.value}>
                <span className="home-proof-line__num">{item.value}</span>
                <span>
                  <b>{item.title}</b>
                  {item.copy}
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div className="home-hero__visual" aria-hidden="true">
          <span className="home-plate-corner home-plate-corner--tl"></span>
          <span className="home-plate-corner home-plate-corner--tr"></span>
          <span className="home-plate-corner home-plate-corner--bl"></span>
          <span className="home-plate-corner home-plate-corner--br"></span>
          <span className="home-plate-annot home-plate-annot--tl">{t("homePlateFig")}</span>
          <span className="home-plate-annot home-plate-annot--tr">{t("homePlateTitle")}</span>
          <img className="home-preview-image" src={productPreviewUrl} alt="" />
          <div className="home-plate-index">
            {plateSteps.map((step, index) => (
              <span className={index === 2 ? "is-active" : undefined} key={step}>
                <span className="home-plate-index__num">0{index + 1}</span>
                {step}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="home-afterfold" aria-label={t("homeAfterfoldAria")}>
        <div className="home-wire-summary">
          <span className="home-wire-mark" aria-hidden="true">
            <CheckCircle2 className="size-4" aria-hidden="true" />
          </span>
          <span>
            <b>{t("homeWireTitle")}</b>
            {t("homeWireMeta")}
          </span>
        </div>
        <div className="home-wire-track" aria-hidden="true">
          <div className="home-wire-track__inner">
            {[...wireItems, ...wireItems].map((item, index) => (
              <span className="home-wire-item" key={`${item}-${index}`}>
                <span>/</span>
                {item}
              </span>
            ))}
          </div>
        </div>
        <button className="home-gallery-link" data-testid="home-gallery-link" type="button" onClick={onOpenGallery}>
          <ImageIcon className="size-4" aria-hidden="true" />
          {t("homeGallery")}
          <ArrowRight className="size-4" aria-hidden="true" />
        </button>
      </section>

      <section className="home-method" aria-labelledby="home-method-title">
        <div className="home-section-heading">
          <p className="home-section-kicker">{t("homeMethodKicker")}</p>
          <h2 id="home-method-title">{t("homeMethodTitle")}</h2>
          <p>{t("homeMethodDeck")}</p>
        </div>
        <div className="home-method-grid">
          {workflowSteps.map((step) => (
            <article className="home-method-step" key={step.value}>
              <span className="home-method-step__num">{step.value}</span>
              <h3>{step.title}</h3>
              <p>{step.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="home-ops" aria-labelledby="home-ops-title">
        <div className="home-ops__copy">
          <p className="home-section-kicker">{t("homeOpsKicker")}</p>
          <h2 id="home-ops-title">{t("homeOpsTitle")}</h2>
          <p>{t("homeOpsDeck")}</p>
        </div>
        <div className="home-ops__panel">
          <div className="home-ops__panel-header">
            <ShieldCheck className="size-5" aria-hidden="true" />
            <span>{t("homeOpsPanelTitle")}</span>
          </div>
          <ul className="home-trust-list">
            {trustItems.map((item) => (
              <li key={item}>
                <CheckCircle2 className="size-4" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <button className="home-gallery-link home-gallery-link--wide" type="button" onClick={onOpenGallery}>
            <ImageIcon className="size-4" aria-hidden="true" />
            {t("homeGalleryReview")}
            <ArrowRight className="size-4" aria-hidden="true" />
          </button>
        </div>
      </section>
    </main>
  );
}
