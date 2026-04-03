-- ═══════════════════════════════════════════════════════════
-- OBSERVATORIO CIUDADANO DE JUAN GUERRA
-- Schema completo para Supabase SQL Editor
-- Pega todo esto en: Supabase → SQL Editor → New query → Run
-- ═══════════════════════════════════════════════════════════


-- ── 1. USUARIOS ──────────────────────────────────────────────
-- El rol se cambia manualmente aquí en Supabase (admin/usuario)
-- NUNCA desde el frontend

CREATE TABLE IF NOT EXISTS usuarios (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    nombre      TEXT NOT NULL,
    email       TEXT NOT NULL UNIQUE,
    password    TEXT NOT NULL,               -- bcrypt hash, nunca texto plano
    rol         TEXT NOT NULL DEFAULT 'usuario' CHECK (rol IN ('admin', 'usuario')),
    activo      BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en   TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para login rápido por email
CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);


-- ── 2. CASOS ─────────────────────────────────────────────────
-- Incidencias urbanas reportadas por ciudadanos

CREATE TABLE IF NOT EXISTS casos (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    titulo      TEXT,
    descripcion TEXT,
    categoria   TEXT CHECK (categoria IN ('vereda','drenaje','obra','otro')),
    ubicacion   TEXT,
    estado      TEXT NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente','en_inspeccion','con_orden_municipal','resuelto')),
    evidencia   TEXT[],                      -- array de URLs (Supabase Storage)
    reportado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    fecha       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_casos_estado    ON casos(estado);
CREATE INDEX IF NOT EXISTS idx_casos_categoria ON casos(categoria);
CREATE INDEX IF NOT EXISTS idx_casos_fecha     ON casos(fecha DESC);


-- ── 3. DENUNCIAS ─────────────────────────────────────────────
-- Formularios de denuncia formal generados por ciudadanos

CREATE TABLE IF NOT EXISTS denuncias (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    titulo      TEXT,
    descripcion TEXT,
    tipo        TEXT,
    hechos      TEXT,
    ubicacion   TEXT,
    danos       TEXT,
    base_legal  TEXT DEFAULT 'RNE / Ordenanza municipal',
    evidencia   TEXT[],
    estado      TEXT NOT NULL DEFAULT 'en_revision'
                    CHECK (estado IN ('en_revision','enviada','respondida','archivada')),
    fecha       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_denuncias_estado ON denuncias(estado);
CREATE INDEX IF NOT EXISTS idx_denuncias_fecha  ON denuncias(fecha DESC);


-- ── 4. GUÍAS TÉCNICAS ────────────────────────────────────────
-- Biblioteca de normas RNE — solo admin puede crear/editar

CREATE TABLE IF NOT EXISTS guias (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    titulo          TEXT NOT NULL,
    descripcion     TEXT,
    categoria       TEXT NOT NULL DEFAULT 'otro'
                        CHECK (categoria IN ('vereda','drenaje','licencia','accesibilidad','otro')),
    norma           TEXT,                    -- ej: "RNE GH.020 Art. 8"
    contenido       TEXT,                    -- HTML con el detalle completo
    enlace_externo  TEXT,                    -- URL al PDF oficial (MVCS, etc.)
    icono           TEXT DEFAULT 'fa-solid fa-book',   -- clase FontAwesome
    color           TEXT DEFAULT 'verde'
                        CHECK (color IN ('verde','azul','teal','naranja','morado','gris')),
    publicado       BOOLEAN NOT NULL DEFAULT TRUE,
    creado_por      UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    fecha           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guias_categoria  ON guias(categoria);
CREATE INDEX IF NOT EXISTS idx_guias_publicado  ON guias(publicado);
CREATE INDEX IF NOT EXISTS idx_guias_fecha      ON guias(fecha DESC);


-- ── 5. ALERTAS ───────────────────────────────────────────────
-- Suscripciones de vecinos por zona

CREATE TABLE IF NOT EXISTS alertas_suscripciones (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email       TEXT NOT NULL,
    zona        TEXT NOT NULL,
    activo      BOOLEAN NOT NULL DEFAULT TRUE,
    fecha       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(email, zona)
);


-- ── 6. DATOS DE EJEMPLO (opcional — borra si no quieres) ─────
-- Guías de ejemplo para arrancar la biblioteca

INSERT INTO guias (titulo, descripcion, categoria, norma, icono, color, contenido, enlace_externo) VALUES

('Dimensiones mínimas de veredas',
 'Ancho libre, pendientes longitudinales y transversales permitidas.',
 'vereda', 'RNE GH.020 Art. 8', 'fa-solid fa-road', 'verde',
 '<h4>¿Qué establece la norma?</h4><p>Ancho mínimo libre: <strong>1.20 m</strong> en zonas residenciales y <strong>2.00 m</strong> en zonas comerciales.</p><h4>Pendientes</h4><ul><li>Longitudinal máxima: <strong>12%</strong></li><li>Transversal (bombeo): <strong>2% a 4%</strong> hacia la calzada</li></ul><h4>Superficie</h4><p>Antideslizante, continua y sin resaltos mayores a 5 mm.</p>',
 'https://www.gob.pe/institucion/mvcs/informes-publicaciones/2406634-reglamento-nacional-de-edificaciones'),

('Rampas y accesibilidad universal',
 'Requisitos de rampas para personas con discapacidad en espacios públicos.',
 'accesibilidad', 'RNE A.120', 'fa-solid fa-universal-access', 'morado',
 '<h4>Pendiente máxima de rampas</h4><ul><li>Hasta 0.25 m de altura: <strong>12%</strong></li><li>Hasta 0.75 m: <strong>10%</strong></li><li>Hasta 1.20 m: <strong>8%</strong></li></ul><h4>Ancho mínimo</h4><p><strong>0.90 m</strong> de ancho libre.</p><h4>Pasamanos</h4><p>Obligatorio en ambos lados cuando supera 3 m, a <strong>0.75 m y 0.90 m</strong> de altura.</p>',
 ''),

('Sistemas de drenaje pluvial',
 'Diseño y mantenimiento de cunetas, sumideros y colectores pluviales.',
 'drenaje', 'RNE OS.060', 'fa-solid fa-droplet', 'azul',
 '<h4>Cunetas</h4><p>Período de retorno mínimo de <strong>10 años</strong> para vías locales.</p><h4>Sumideros</h4><p>En esquinas y cada 50 m entre sumideros consecutivos.</p><h4>Mantenimiento</h4><p>Responsabilidad municipal antes de la temporada de lluvias.</p>',
 ''),

('¿Cuándo se necesita licencia de construcción?',
 'Tipos de licencia, modalidades y qué obras requieren autorización municipal.',
 'licencia', 'Ley 29090', 'fa-solid fa-file-signature', 'naranja',
 '<h4>Modalidades</h4><ul><li><strong>A:</strong> Cercos hasta 3 m, refacción sin cambio estructural</li><li><strong>B:</strong> Hasta 5 pisos y 3,000 m²</li><li><strong>C y D:</strong> Mayor envergadura — evaluación por comisión</li></ul><h4>Sin licencia</h4><p>La municipalidad puede paralizar, demoler y aplicar multas según el TUPA.</p>',
 ''),

('Ocupación de vía pública',
 'Prohibiciones en veredas: comercio, materiales de construcción, vehículos.',
 'vereda', 'RNE GH.020 + Ordenanza Municipal', 'fa-solid fa-ban', 'gris',
 '<h4>Prohibido en vereda</h4><ul><li>Materiales de construcción sin autorización temporal</li><li>Vehículos que obstruyan el paso peatonal</li><li>Puestos comerciales sin licencia de uso de vía</li><li>Desniveles sin autorización municipal</li></ul><h4>¿Cómo denunciar?</h4><p>Reporta el caso en este Observatorio con fotos y ubicación exacta.</p>',
 ''),

('Bermas y áreas verdes urbanas',
 'Normas sobre bermas laterales y mantenimiento de áreas verdes en vías.',
 'otro', 'RNE GH.020 Art. 12', 'fa-solid fa-leaf', 'teal',
 '<h4>Definición</h4><p>Franja entre calzada y vereda destinada a arborización o separación de flujos.</p><h4>Usos permitidos</h4><ul><li>Arborización de bajo mantenimiento</li><li>Estacionamiento temporal señalizado</li><li>Infraestructura de servicios soterrada</li></ul><h4>Responsabilidad</h4><p>Mantenimiento a cargo de la municipalidad.</p>',
 '')

ON CONFLICT DO NOTHING;


-- ═══════════════════════════════════════════════════════════
-- CÓMO HACER A ALGUIEN ADMIN MANUALMENTE:
--
-- UPDATE usuarios SET rol = 'admin' WHERE email = 'tucorreo@ejemplo.com';
--
-- ═══════════════════════════════════════════════════════════
