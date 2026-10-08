import { ArrowDown, Check, CircleAlert, PenLine, Plus, Quote, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../../api/client'
import {
  AI_FIELDS,
  MODES,
  SESSION_TYPES,
  SETTINGS,
  THERAPIST_FIELDS,
  newStatementId,
  useApproveReport,
  useRequestDraft,
  useSaveReport,
  type AiField,
  type Report,
  type ReportContent,
  type Statement,
} from '../../api/reports'
import type { ServerSession, Transcript } from '../../api/sessions'
import { errorMessage } from '../../i18n/errors'
import { formatDate } from '../format'
import { overlaps } from './overlaps'
import { SourceTranscript } from './SourceTranscript'

function statementFlags(s: Statement): string[] {
  const flags: string[] = []
  if (s.origin === 'ai' && s.support && s.support !== 'supported') flags.push(s.support)
  if (s.wording.length > 0) flags.push('wording')
  if (s.third_party_name) flags.push('name')
  return flags
}

/** Blocking as the server computes it, also for edits not saved yet. */
function blocks(s: Statement): boolean {
  return (
    s.origin === 'ai' &&
    !s.resolved &&
    (s.support !== 'supported' || s.ai_wording.length > 0 || s.third_party_name)
  )
}

export function ReportEditor({
  report,
  session,
  transcript,
}: {
  report: Report
  session: ServerSession
  transcript: Transcript | undefined
}) {
  const { t, i18n } = useTranslation()
  const save = useSaveReport(session.id)
  const approve = useApproveReport(session.id)
  const requestDraft = useRequestDraft(session.id)
  const [content, setContent] = useState<ReportContent>(report.content)
  const [dirty, setDirty] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  // Server updates (save, new draft) replace local state unless there are unsaved edits.
  const [serverContent, setServerContent] = useState(report.content)
  if (report.content !== serverContent && !dirty) {
    setServerContent(report.content)
    setContent(report.content)
  }

  const statements = useMemo(
    () => AI_FIELDS.flatMap((code) => content.ai[code].statements),
    [content],
  )
  const blocking = statements.filter(blocks).length
  const selectedStatement = statements.find((s) => s.id === selected) ?? null
  const busy = save.isPending || approve.isPending || requestDraft.isPending
  const error = save.error ?? approve.error ?? requestDraft.error

  function update(next: ReportContent) {
    setContent(next)
    setDirty(true)
  }

  function updateStatements(code: AiField, change: (list: Statement[]) => Statement[]) {
    const list = change(content.ai[code].statements)
    update({
      ...content,
      ai: { ...content.ai, [code]: { status: list.length ? 'content' : 'not_discussed', statements: list } },
    })
  }

  async function saveNow(): Promise<boolean> {
    try {
      await save.mutateAsync(content)
      setDirty(false)
      return true
    } catch {
      return false
    }
  }

  async function regenerate(field: AiField | null) {
    if (field === null && !window.confirm(t('report.regenerateAllConfirm'))) return
    if (dirty && !(await saveNow())) return
    requestDraft.mutate(field)
  }

  async function approveNow() {
    if (!window.confirm(t('report.approveConfirm'))) return
    if (dirty && !(await saveNow())) return
    approve.mutate()
  }

  function selectSegment(start: number, end: number) {
    const hit = statements.find((s) => s.refs.some(([a, b]) => overlaps(a, b, start, end)))
    setSelected(hit?.id ?? null)
  }

  /** Jump to the next AI sentence that still needs a decision, after the current one. */
  function nextToCheck() {
    const open = statements.filter(blocks)
    const from = open.findIndex((s) => s.id === selected)
    const next = open[(from + 1) % open.length]
    if (!next) return
    setSelected(next.id)
    const field = document.getElementById(`statement-${next.id}`)
    field?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    field?.focus({ preventScroll: true })
  }

  const header = content.header

  return (
    <div className="report-layout">
      <div className="report-source">
        {transcript ? (
          <SourceTranscript
            transcript={transcript}
            highlight={selectedStatement?.refs ?? []}
            onSelect={selectSegment}
          />
        ) : (
          <p className="muted">{t('common.loading')}</p>
        )}
      </div>

      <div className="report-note stack">
        {report.ai_assisted && (
          <p className="banner warning" role="status">
            <strong>{t('report.aiDraftBanner')}</strong> {t('report.aiDraftHint')}
          </p>
        )}

        <div className="card stack">
          <SectionTitle step={1} title={t('report.header')} />
          <dl className="details">
            <dt>{t('report.date')}</dt>
            <dd>{formatDate(session.started_at, i18n.language)}</dd>
          </dl>
          <div className="report-grid">
            <label>
              {t('report.sessionNo')}
              <input
                value={header.session_no ?? ''}
                placeholder={String(report.default_session_no)}
                maxLength={20}
                onChange={(e) =>
                  update({ ...content, header: { ...header, session_no: e.target.value || null } })
                }
              />
            </label>
            <label>
              {t('report.sessionType')}
              <select
                value={header.session_type ?? ''}
                onChange={(e) =>
                  update({
                    ...content,
                    header: {
                      ...header,
                      session_type: (e.target.value || null) as ReportContent['header']['session_type'],
                    },
                  })
                }
              >
                <option value="">—</option>
                {SESSION_TYPES.map((v) => (
                  <option key={v} value={v}>
                    {t(`report.sessionTypes.${v}`)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('report.setting')}
              <select
                value={header.setting}
                onChange={(e) =>
                  update({
                    ...content,
                    header: { ...header, setting: e.target.value as ReportContent['header']['setting'] },
                  })
                }
              >
                {SETTINGS.map((v) => (
                  <option key={v} value={v}>
                    {t(`report.settings.${v}`)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('report.mode')}
              <select
                value={header.mode}
                onChange={(e) =>
                  update({
                    ...content,
                    header: { ...header, mode: e.target.value as ReportContent['header']['mode'] },
                  })
                }
              >
                {MODES.map((v) => (
                  <option key={v} value={v}>
                    {t(`report.modes.${v}`)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('report.attendeesExtra')}
              <input
                value={header.attendees_extra}
                maxLength={200}
                onChange={(e) =>
                  update({ ...content, header: { ...header, attendees_extra: e.target.value } })
                }
              />
            </label>
            <label>
              {t('report.location')}
              <input
                value={header.location}
                maxLength={200}
                onChange={(e) => update({ ...content, header: { ...header, location: e.target.value } })}
              />
            </label>
          </div>
        </div>

        <div className="card stack">
          <div className="row spread">
            <SectionTitle step={2} title={t('report.aiPart')} />
            {report.ai_assisted && (
              <button className="ghost small-button" disabled={busy} onClick={() => void regenerate(null)}>
                <RefreshCw className="icon" aria-hidden="true" />
                {t('report.regenerateAll')}
              </button>
            )}
          </div>
          {AI_FIELDS.map((code) => (
            <section key={code} className="report-field" aria-labelledby={`field-${code}`}>
              <div className="row spread">
                <h3 id={`field-${code}`}>{t(`report.fields.${code}`)}</h3>
                {report.ai_assisted && (
                  <button className="ghost small-button" disabled={busy} onClick={() => void regenerate(code)}>
                    <RefreshCw className="icon" aria-hidden="true" />
                    {t('report.regenerate')}
                  </button>
                )}
              </div>
              {content.ai[code].statements.length === 0 && (
                <p className="muted small">{t('report.notDiscussed')}</p>
              )}
              <ul className="statements">
                {content.ai[code].statements.map((s) => (
                  <li
                    key={s.id}
                    className={`statement ${blocks(s) ? 'blocking' : ''} ${selected === s.id ? 'selected' : ''}`}
                  >
                    <span className={`origin origin-${s.origin}`}>
                      {s.origin === 'ai' ? (
                        <Sparkles className="icon" aria-hidden="true" />
                      ) : (
                        <PenLine className="icon" aria-hidden="true" />
                      )}
                      {t(`report.origin.${s.origin}`)}
                    </span>
                    <textarea
                      id={`statement-${s.id}`}
                      aria-label={t('report.statementLabel', { field: t(`report.fields.${code}`) })}
                      value={s.text}
                      rows={Math.max(1, Math.ceil(s.text.length / 70))}
                      maxLength={1000}
                      onFocus={() => setSelected(s.id)}
                      onChange={(e) =>
                        updateStatements(code, (list) =>
                          list.map((x) => (x.id === s.id ? { ...x, text: e.target.value, resolved: true } : x)),
                        )
                      }
                    />
                    <div className="statement-meta">
                      {statementFlags(s).map((flag) => (
                        <span key={flag} className="badge attention flag" title={t(`report.flagHints.${flag}`)}>
                          {flag === 'wording'
                            ? t('report.flags.wording', { words: s.wording.join(', ') })
                            : t(`report.flags.${flag}`)}
                        </span>
                      ))}
                      {s.origin === 'ai' && s.refs.length > 0 && (
                        <button className="ghost small-button" onClick={() => setSelected(s.id)}>
                          <Quote className="icon" aria-hidden="true" />
                          {t('report.showSource')}
                        </button>
                      )}
                      {s.notes.length > 0 && <span className="muted small">{t('report.fromNote')}</span>}
                      {blocks(s) && (
                        <button
                          className="secondary small-button"
                          onClick={() =>
                            updateStatements(code, (list) =>
                              list.map((x) => (x.id === s.id ? { ...x, resolved: true } : x)),
                            )
                          }
                        >
                          <Check className="icon" aria-hidden="true" />
                          {t('report.keep')}
                        </button>
                      )}
                      <button
                        className="ghost small-button danger push-right"
                        onClick={() => updateStatements(code, (list) => list.filter((x) => x.id !== s.id))}
                      >
                        <Trash2 className="icon" aria-hidden="true" />
                        {t('report.delete')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <button
                className="ghost small-button add-statement"
                onClick={() =>
                  updateStatements(code, (list) => [
                    ...list,
                    {
                      id: newStatementId(),
                      text: '',
                      kind: null,
                      origin: 'therapist',
                      refs: [],
                      notes: [],
                      support: null,
                      ai_wording: [],
                      wording: [],
                      third_party_name: false,
                      resolved: true,
                      blocking: false,
                    },
                  ])
                }
              >
                <Plus className="icon" aria-hidden="true" />
                {t('report.addStatement')}
              </button>
            </section>
          ))}
        </div>

        <div className="card stack">
          <SectionTitle step={3} title={t('report.therapistPart')} />
          <p className="muted small">{t('report.therapistPartHint')}</p>
          {THERAPIST_FIELDS.map((code) => (
            <label key={code} className="report-field">
              <span className="field-label">{t(`report.fields.${code}`)}</span>
              <span className="muted small">{t(`report.prompts.${code}`)}</span>
              <textarea
                value={content.therapist[code]}
                rows={3}
                maxLength={5000}
                onChange={(e) =>
                  update({ ...content, therapist: { ...content.therapist, [code]: e.target.value } })
                }
              />
            </label>
          ))}
        </div>

        <div className="report-actions" aria-label={t('report.actions')} role="region">
          <div className="report-actions-status">
            {blocking > 0 ? (
              <p role="status">
                <CircleAlert className="icon attention-icon" aria-hidden="true" />
                {t('report.blocking', { count: blocking })}
              </p>
            ) : (
              <p className="muted small">{t('report.approveHint')}</p>
            )}
            <p className="save-state small">
              <span className={`save-dot${dirty ? ' unsaved' : ''}`} aria-hidden="true" />
              {dirty ? t('report.unsaved') : t('report.saved')}
            </p>
            {error && (
              <p className="form-error" role="alert">
                {errorMessage(t, error instanceof ApiError ? error.code : 'unknown')}
              </p>
            )}
          </div>
          <div className="actions">
            {blocking > 0 && (
              <button className="ghost" onClick={nextToCheck}>
                <ArrowDown className="icon" aria-hidden="true" />
                {t('report.nextToCheck')}
              </button>
            )}
            <button className="secondary" disabled={busy || !dirty} onClick={() => void saveNow()}>
              {t('report.save')}
            </button>
            <button className="primary" disabled={busy || blocking > 0} onClick={() => void approveNow()}>
              <Check className="icon" aria-hidden="true" />
              {t('report.approve')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SectionTitle({ step, title }: { step: number; title: string }) {
  return (
    <h2 className="section-title">
      <span className="step" aria-hidden="true">
        {step}
      </span>
      {title}
    </h2>
  )
}
