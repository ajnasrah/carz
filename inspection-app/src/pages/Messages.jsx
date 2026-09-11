// The text log, read as conversations.
//
// Two views, one screen: the list of people, and one person's thread. On a phone
// the thread replaces the list; on a desktop they sit side by side. The question
// this screen answers is "what did we send him, did it land, and did he answer" —
// so a failure is loud, a reply is the accent colour, and everything else is quiet.

import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, AlertTriangle, RefreshCw, MessageSquare, CornerUpLeft } from 'lucide-react'
import { useAuth } from '../context/useAuth'
import { isPrimaryAdmin } from '../services/adminSetup'
import {
  fetchMessages, toThreads, prettyPhone, whenLabel, shortError,
} from '../services/smsLog'

function Bubble({ m }) {
  const inbound = m.direction === 'in'
  const failed = m.status === 'failed'
  return (
    <div className={`flex ${inbound ? 'justify-start' : 'justify-end'} mb-2`}>
      <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 ${
        inbound
          ? 'bg-emerald-500/15 border border-emerald-500/30 rounded-bl-sm'
          : failed
            ? 'bg-red-500/10 border border-red-500/40 rounded-br-sm'
            : 'bg-slate-800 rounded-br-sm'
      }`}>
        <p className="text-sm text-slate-100 whitespace-pre-wrap">{m.body}</p>
        <p className="text-[11px] mt-1 flex items-center gap-1.5 text-slate-500">
          {inbound && <CornerUpLeft size={11} className="text-emerald-400" />}
          {whenLabel(m.created_at)}
          {m.source && !inbound && <span className="opacity-60">· {m.source}</span>}
        </p>
        {failed && (
          <p className="text-[11px] text-red-300 mt-1 flex items-start gap-1">
            <AlertTriangle size={11} className="mt-0.5 shrink-0" />
            {shortError(m.error) || 'Did not send'}
          </p>
        )}
      </div>
    </div>
  )
}

export default function Messages() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openKey, setOpenKey] = useState(null)
  const [failedOnly, setFailedOnly] = useState(false)

  const admin = profile?.role === 'admin' || isPrimaryAdmin(profile?.phone)

  useEffect(() => {
    if (!admin) { navigate('/'); return }
    let cancelled = false
    async function first() {
      try {
        const rows = await fetchMessages()
        if (!cancelled) setMessages(rows)
      } catch (e) {
        if (!cancelled) setError(e.message)
      }
      if (!cancelled) setLoading(false)
    }
    first()
    return () => { cancelled = true }
  }, [admin, navigate])

  async function refresh() {
    setLoading(true)
    try {
      setMessages(await fetchMessages())
      setError('')
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  const threads = useMemo(() => toThreads(messages), [messages])
  const shown = failedOnly ? threads.filter((t) => t.failed > 0) : threads
  const open = threads.find((t) => t.key === openKey) || null
  const totalFailed = threads.reduce((n, t) => n + t.failed, 0)

  if (!admin) return null

  return (
    <div className="page">
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => (open ? setOpenKey(null) : navigate('/admin'))}
          className="p-2 rounded-lg bg-slate-800"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="page-title mb-0 flex-1">
          {open ? (open.name || prettyPhone(open.phone)) : 'Messages'}
        </h1>
        <button onClick={refresh} className="p-2 rounded-lg bg-slate-800" title="Refresh">
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

      {/* The thread, on its own, once one is picked. */}
      {open && (
        <div>
          <p className="text-xs text-slate-500 mb-3">
            {prettyPhone(open.phone)} · {open.messages.length} messages
            {open.replies > 0 && ` · ${open.replies} from him`}
          </p>
          {open.messages.map((m) => <Bubble key={m.id} m={m} />)}
        </div>
      )}

      {/* Otherwise, everyone. */}
      {!open && (
        <>
          {totalFailed > 0 && (
            <button
              onClick={() => setFailedOnly(!failedOnly)}
              className={`w-full mb-3 rounded-lg px-3 py-2 text-sm flex items-center gap-2 ${
                failedOnly
                  ? 'bg-red-500 text-white'
                  : 'bg-red-500/10 border border-red-500/40 text-red-300'
              }`}
            >
              <AlertTriangle size={15} />
              {totalFailed} {totalFailed === 1 ? 'text' : 'texts'} did not send
              <span className="ml-auto opacity-70">{failedOnly ? 'show all' : 'show me'}</span>
            </button>
          )}

          {loading && !messages.length && <p className="text-slate-400">Loading...</p>}

          {!loading && !shown.length && (
            <div className="card text-center text-slate-400">
              <MessageSquare size={28} className="mx-auto mb-2 opacity-40" />
              {failedOnly ? 'Nothing has failed.' : 'Nothing has been sent yet.'}
              {!failedOnly && (
                <p className="text-xs mt-1 opacity-70">
                  The first checklist text will show up here.
                </p>
              )}
            </div>
          )}

          {shown.map((t) => (
            <button
              key={t.key}
              onClick={() => setOpenKey(t.key)}
              className="card w-full text-left mb-2 flex items-start gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="font-bold text-slate-100">{t.name || prettyPhone(t.phone)}</p>
                  {t.failed > 0 && (
                    <span className="text-[11px] bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded-full">
                      {t.failed} failed
                    </span>
                  )}
                  {t.replies > 0 && (
                    <span className="text-[11px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded-full">
                      {t.replies} replied
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-400 truncate">
                  {t.last.direction === 'in' ? '↩ ' : ''}{t.last.body}
                </p>
              </div>
              <span className="text-[11px] text-slate-500 shrink-0 pt-0.5">
                {whenLabel(t.last.created_at)}
              </span>
            </button>
          ))}
        </>
      )}
    </div>
  )
}
