// src/components/CamarasVolcan.tsx
//
// Lee el estado de las cámaras desde la tabla camaras_externas en vez de
// depender de IDs de YouTube escritos a mano en el código.
//
// Ajustar la ruta del cliente de Supabase según el proyecto.

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type EstadoCamara =
  | "en_vivo"
  | "sin_transmision"
  | "no_encontrada"
  | "error"
  | "desconocido";

interface Camara {
  slug: string;
  nombre: string;
  youtube_id: string | null;
  estado: EstadoCamara;
  url_publica: string;
  verificado_en: string | null;
}

/** Un solo estado transmitible; el resto se trata como no disponible. */
const esReproducible = (c: Camara) =>
  Boolean(c.youtube_id) && (c.estado === "en_vivo" || c.estado === "desconocido");

function mensajeNoDisponible(c: Camara): string {
  switch (c.estado) {
    case "sin_transmision":
      return `El centro no está transmitiendo la cámara ${c.nombre} en este momento.`;
    case "no_encontrada":
      return `La cámara ${c.nombre} ya no aparece en el sitio del centro.`;
    case "error":
      return "No se pudo consultar el sitio del centro. Reintentamos cada 15 minutos.";
    default:
      return `La transmisión de la cámara ${c.nombre} no está disponible en este momento.`;
  }
}

function horaLocal(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function useCamaras() {
  const [camaras, setCamaras] = useState<Camara[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vigente = true;

    async function cargar() {
      const { data, error } = await supabase
        .from("camaras_externas")
        .select("slug, nombre, youtube_id, estado, url_publica, verificado_en")
        .eq("activa", true)
        .order("orden");

      if (!vigente) return;
      if (error) console.error("Error al cargar cámaras:", error.message);
      setCamaras((data as Camara[]) ?? []);
      setCargando(false);
    }

    cargar();

    // El job corre cada 15 min; refrescar al volver a la pestaña cubre el resto.
    const alVolver = () => document.visibilityState === "visible" && cargar();
    document.addEventListener("visibilitychange", alVolver);
    const intervalo = window.setInterval(cargar, 5 * 60 * 1000);

    return () => {
      vigente = false;
      document.removeEventListener("visibilitychange", alVolver);
      window.clearInterval(intervalo);
    };
  }, []);

  return { camaras, cargando };
}

export default function CamarasVolcan() {
  const { camaras, cargando } = useCamaras();

  if (cargando) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="aspect-video animate-pulse rounded-xl bg-slate-800/60" />
        ))}
      </div>
    );
  }

  const hayAlgunaEnVivo = camaras.some((c) => c.estado === "en_vivo");

  return (
    <section>
      <header className="mb-4 flex items-center gap-3">
        <h2 className="text-lg text-amber-200">Cámaras en vivo</h2>
        {hayAlgunaEnVivo && (
          <span className="rounded-full bg-red-500/15 px-2.5 py-0.5 text-xs tracking-wide text-red-300">
            ● EN VIVO
          </span>
        )}
      </header>

      <div className="grid gap-5 md:grid-cols-2">
        {camaras.map((camara) => (
          <figure key={camara.slug}>
            <div className="aspect-video overflow-hidden rounded-xl border border-slate-700/60 bg-slate-900">
              {esReproducible(camara) ? (
                <iframe
                  src={`https://www.youtube.com/embed/${camara.youtube_id}?autoplay=1&mute=1&playsinline=1`}
                  title={camara.nombre}
                  allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  loading="lazy"
                  className="h-full w-full"
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                  <p className="text-sm text-slate-400">{mensajeNoDisponible(camara)}</p>
                  <a
                    href={camara.url_publica}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-amber-300 underline underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                  >
                    Ver en el sitio del centro
                  </a>
                </div>
              )}
            </div>

            <figcaption className="mt-2 flex items-baseline justify-between text-sm">
              <span className="text-slate-200">{camara.nombre}</span>
              {camara.verificado_en && (
                <span className="text-xs text-slate-500">
                  Revisado {horaLocal(camara.verificado_en)}
                </span>
              )}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
