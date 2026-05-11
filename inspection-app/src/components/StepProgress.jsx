import { STEPS } from '../services/inspectionFlow'
import { Check } from 'lucide-react'

export default function StepProgress({ currentStep, completedSteps = [], steps = STEPS, onStepClick }) {
  const currentIdx = steps.findIndex((s) => s.key === currentStep)
  const clickable = typeof onStepClick === 'function'

  return (
    <div className="flex items-center gap-1 mb-6 px-1">
      {steps.map((step, idx) => {
        const isComplete = completedSteps.includes(step.key)
        const isCurrent = idx === currentIdx
        const isPast = idx < currentIdx

        const content = (
          <>
            <div
              className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                isComplete
                  ? 'bg-emerald-500 text-slate-900'
                  : isCurrent
                    ? 'bg-emerald-500 text-slate-900 ring-2 ring-emerald-400 ring-offset-2 ring-offset-slate-900'
                    : isPast
                      ? 'bg-emerald-500/40 text-emerald-300'
                      : 'bg-slate-700 text-slate-500'
              }`}
            >
              {isComplete ? <Check size={14} strokeWidth={3} /> : idx + 1}
            </div>
            <span
              className={`text-[11px] font-semibold leading-tight text-center mt-1 ${
                isCurrent ? 'text-emerald-400' : isPast || isComplete ? 'text-slate-300' : 'text-slate-500'
              }`}
            >
              {step.short}
            </span>
          </>
        )

        if (clickable) {
          return (
            <button
              type="button"
              key={step.key}
              onClick={() => onStepClick(step.key)}
              className="flex-1 flex flex-col items-center gap-0 active:opacity-60"
            >
              {content}
            </button>
          )
        }
        return (
          <div key={step.key} className="flex-1 flex flex-col items-center gap-0">
            {content}
          </div>
        )
      })}
    </div>
  )
}
