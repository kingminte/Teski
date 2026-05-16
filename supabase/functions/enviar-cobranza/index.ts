// Edge Function: enviar-cobranza
// Envía un email transaccional vía Resend.
// Despliegue:
//   supabase functions deploy enviar-cobranza
// Secretos requeridos:
//   supabase secrets set RESEND_API_KEY=re_xxx
//   supabase secrets set RESEND_FROM="Teski Club <tesoreria@tudominio.cl>"
//   (el dominio debe estar verificado en Resend)

import "jsr:@supabase/functions-js/edge-runtime.d.ts"

interface Payload {
  destinatario: string
  asunto: string
  html: string
  copia?: string
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método no permitido' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: Payload
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { destinatario, asunto, html, copia } = body
  if (!destinatario || !asunto || !html) {
    return new Response(
      JSON.stringify({ error: 'destinatario, asunto y html son obligatorios' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const apiKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('RESEND_FROM') ?? 'Teski Club <onboarding@resend.dev>'

  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error: 'RESEND_API_KEY no configurada en secrets',
        hint: 'supabase secrets set RESEND_API_KEY=re_xxx',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [destinatario],
      ...(copia ? { cc: [copia] } : {}),
      subject: asunto,
      html,
    }),
  })

  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    return new Response(
      JSON.stringify({ error: 'Resend rechazó el envío', detalle: data }),
      { status: res.status, headers: { 'Content-Type': 'application/json' } },
    )
  }

  return new Response(JSON.stringify({ ok: true, id: data.id }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
