"use client"

import { useState } from "react"
import { KeyRound, Eye, EyeOff } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { visibleFields } from "@larkup/vector-stores/registry"
import type { IndexType, VectorStoreDescriptor } from "@larkup/core/types"

interface StoreFieldsProps {
  store: VectorStoreDescriptor
  values: Record<string, string>
  errors: Record<string, string>
  onChange: (key: string, value: string) => void
  /** Global index type — controls showWhenIndexType visibility (e.g. sparse model for hybrid/lexical) */
  indexType?: IndexType
}

/**
 * Renders ONLY the fields the selected store needs, honoring `showWhen`
 * dependencies (e.g. LanceDB local-vs-cloud). Driven entirely by the
 * registry, so adding a new store requires no changes here.
 */
export function StoreFields({
  store,
  values,
  errors,
  onChange,
  indexType,
}: StoreFieldsProps) {
  const fields = visibleFields(store, values, indexType)
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({})

  const togglePassword = (key: string) => {
    setShowPasswords((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {fields.map((field) => {
        const value = values[field.key] ?? field.defaultValue ?? ""
        const error = errors[field.key]
        const fieldId = `store-${field.key}`

        return (
          <div
            key={field.key}
            className={cn(
              "space-y-1.5",
              field.type === "select" && "sm:col-span-1",
            )}
          >
            <div className="flex items-center gap-1.5">
              <Label htmlFor={fieldId}>{field.label}</Label>
              {field.required && (
                <span className="text-destructive" aria-hidden>
                  *
                </span>
              )}
              {field.secret && (
                <Badge
                  variant="outline"
                  className="h-4 gap-1 px-1 text-[9px] font-mono uppercase text-muted-foreground"
                >
                  <KeyRound className="size-2.5" />
                  secret
                </Badge>
              )}
            </div>

            {field.type === "select" ? (
              <Select
                value={value}
                onValueChange={(v) => onChange(field.key, (v as string) ?? "")}
              >
                <SelectTrigger id={fieldId} className="w-full">
                  <SelectValue placeholder={`Select ${field.label}`} />
                </SelectTrigger>
                <SelectContent>
                  {field.options?.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : field.type === "password" ? (
              <div className="relative">
                <Input
                  id={fieldId}
                  type={showPasswords[field.key] ? "text" : "password"}
                  placeholder={field.placeholder}
                  value={value}
                  spellCheck={false}
                  autoComplete="off"
                  className={cn(
                    "font-mono text-sm pr-9",
                    error && "border-destructive",
                  )}
                  onChange={(e) => onChange(field.key, e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => togglePassword(field.key)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showPasswords[field.key] ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
            ) : (
              <Input
                id={fieldId}
                type="text"
                placeholder={field.placeholder}
                value={value}
                spellCheck={false}
                autoComplete="off"
                className={cn(
                  field.type === "path" && "font-mono text-sm",
                  error && "border-destructive",
                )}
                onChange={(e) => onChange(field.key, e.target.value)}
              />
            )}

            {error ? (
              <p className="text-xs text-destructive">{error}</p>
            ) : field.help ? (
              <p className="text-xs text-muted-foreground leading-relaxed">
                {field.help}
              </p>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
