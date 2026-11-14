# Manual de Uso y Funcionamiento — Bolsa de Empleo Tejedor

> **Versión:** `2026-11-13` (Post-auditoría final aprobada · `commit b23a8fe`)  
> **Propósito de este documento:** Describir de punta a punta cómo funciona hoy la plataforma para cada perfil de usuario, las reglas legales y de privacidad vigentes (Ley 25.326 y Ley 26.390), y los controles técnicos implementados, para contraponer con la *Documentación del proyecto en 11 pasos* y redactar las comunicaciones.

---

## 1. Perfiles de Usuario y Qué Ve Cada Uno

### 1.1. Visitante sin sesión (Vista Pública Restringida)
Cualquier vecino puede recorrer la portada (`/`) y los directorios (`/avisos` y `/postulantes`) sin iniciar sesión, pero con **datos sensibles protegidos desde el servidor**:

- **En `/avisos` (Ofertas laborales):**
  - Ve puesto, rubro, localidad, modalidad, horario, fecha de publicación y descripción del trabajo (filtrada por `mask_contact_info` para ocultar teléfonos, mails o links de WhatsApp).
  - **No ve** el nombre real del comercio (se muestra `"Comercio local verificado"`), logo, dirección, teléfono, WhatsApp, email, persona de contacto ni fecha de inicio de actividades.
  - Al intentar ver el detalle de contacto o postularse, el sistema lo invita a iniciar sesión o registrarse.
- **En `/postulantes` (Directorio de talentos):**
  - Solo aparecen perfiles activos (`is_searching = true`) que tengan **fecha de nacimiento cargada y 18 años o más**.
  - **Los menores de 16 y 17 años y los perfiles sin fecha de nacimiento están completamente excluidos** de la vista anónima.
  - De los mayores de 18 visibles, el visitante anónimo solo ve: nombre de pila, **inicial del apellido** (ej. `Juan P.`), localidad, rubro/puestos, disponibilidad, nivel educativo y presentación breve (filtrada por `mask_contact_info`).
  - **No ve** apellido completo, edad (`age = null`), indicador de menor (`is_minor = false`), foto de perfil (`avatar_url = null`), teléfono, correo ni CV (`cv_path = null`).

---

### 1.2. Postulante (Mayor de 18 años y Menores de 16–17 años)

#### A. Ingreso y Aceptación Legal (`/ingresar` → Pestaña *"Soy Postulante"*)
1. Ingresa su correo electrónico.
2. Si es la primera vez (o si cambió la versión de los textos legales, actualmente `2026-11-13`), debe tildar obligatoriamente:
   - *"Tengo 16 años o más (si tengo 16 o 17 cuento con autorización de mi padre, madre o tutor según Ley 26.390) y acepto los Términos y Condiciones y la Política de Privacidad."*
3. Recibe un código de 6 dígitos (OTP) por correo y entra sin necesidad de contraseña fija.
4. En ingresos futuros desde ese dispositivo (o tras validar su correo), **no se le vuelve a pedir el checkbox** mientras no cambie la versión legal (`TERMS_VERSION`), ya que el servidor verifica en `terms_acceptances` que esa cuenta ya aceptó la versión vigente.

#### B. Carga y Edición de Perfil (`/mi-perfil-postulante`)
- **Datos obligatorios:** Nombre, apellido, fecha de nacimiento (mínimo 16 años cumplidos), teléfono con código de área, localidad (partido de Carlos Tejedor y localidades), situación laboral, disponibilidad, nivel de estudios, al menos un rubro/puesto y presentación breve.
- **Datos opcionales:** Foto de perfil y CV en formato PDF (almacenado en bucket privado con acceso auditado).
- **Filtro anti-datos de contacto en textos libres:** La presentación breve (`bio_short`) y el campo `"Otro puesto"` pasan por `mask_contact_info` para evitar que queden expuestos teléfonos (`2364...`, `236.445.678`, `$2364456789`, `wa.me/...`) o correos en la vista pública, sin afectar montos salariales (`$1.500.000`), números con miles (`12.500.000`), años (`2015-2020`) ni fechas (`12/11/2026`).
- **Control de visibilidad:** El postulante puede **pausar o activar** su búsqueda (`is_searching`) en cualquier momento con un interruptor.

#### C. Reglas Especiales para Menores de 16 y 17 años (Ley 26.390)
- **Menores de 16 años:** El sistema rechaza el registro tanto en el formulario como en la base de datos.
- **Postulantes de 16 y 17 años:**
  1. Al ingresar una fecha de nacimiento correspondiente a 16 o 17 años, se despliega obligatoriamente la sección **"Autorización de Madre, Padre o Tutor (Ley 26.390)"**.
  2. Debe completar **nombre y apellido del adulto responsable**, **teléfono del adulto responsable** y confirmar la declaración jurada de autorización.
  3. Opcionalmente puede cargar el **correo electrónico del adulto responsable**:
     - Si lo informa, el sistema envía automáticamente un correo informativo al tutor avisando del alta y explicando cómo solicitar la baja si no autoriza.
     - **Tope antispam:** Máximo **1 aviso cada 30 días** y **máximo 3 avisos en total por cuenta** (`guardian_notice_count`). Si el envío por Brevo falla técnicamente, el sistema revierte la marca y devuelve el cupo para no perjudicar al usuario.
     - Esta restricción de correo **nunca bloquea** al joven para guardar su perfil ni para postularse a todos los avisos laborales que desee.
  4. **Protección reforzada de imagen y directorio:**
     - No aparecen jamás en el directorio público anónimo.
     - Su **foto de perfil se mantiene oculta (`NULL`)** incluso frente a comercios registrados (tanto en el directorio de postulantes como en el listado de postulados a un aviso).
     - Los comercios registrados ven una insignia clara **`"Menor (16-17 años · Ley 26.390)"`** junto con la edad.
  5. **Mayoría de edad automática:** Cuando el postulante cumple 18 años, al actualizar su perfil el sistema limpia automáticamente los datos del tutor.

#### D. Postulación a Avisos (`/avisos`)
- El postulante registrado sí ve los datos completos del comercio en cada aviso.
- Puede postularse con un clic desde la plataforma o contactar según las vías habilitadas por el comercio.
- Recibe notificaciones por correo cuando el comercio actualiza el estado de su postulación.

---

### 1.3. Comercio / Empresa / Empleador

#### A. Ingreso y Aceptación Legal (`/ingresar` → Pestaña *"Soy Comercio"*)
1. Ingresa su correo electrónico.
2. Si aún no aceptó la versión legal vigente (`2026-11-13`), tilda:
   - *"Acepto los Términos y Condiciones y la Política de Privacidad en representación del comercio o empleador."* (Sin mención redundante de edad ni campo de fecha de nacimiento).
3. En próximos ingresos, si ya aceptó la versión vigente, ingresa directo sin que reaparezca la casilla legal.

#### B. Perfil del Comercio y Publicación de Avisos (`/panel-comercio`)
- **Datos del comercio:** Nombre comercial, rubro, localidad, persona de contacto, teléfono, dirección, descripción, redes/web, logo y **Fecha de inicio de actividades (opcional)**.
  - *Validación de fecha de inicio de actividades:* No permite fechas futuras ni anteriores a `1850-01-01`. Si el comercio la completa, se muestra en su ficha visible para usuarios registrados (`"Inicio de actividades: Mes Año"`).
- **Gestión de avisos laborales:**
  - Crear, editar, pausar, reactivar o cerrar búsquedas laborales.
  - Ver postulantes inscriptos a cada búsqueda y cambiar su estado (*Pendiente*, *En revisión*, *Contactado*, *Descartado*).
- **Acceso al Directorio de Postulantes (`/postulantes`):**
  - Ve los perfiles completos (incluidos jóvenes de 16–17 años identificados con su insignia legal y sin foto).
  - Puede abrir el CV en PDF (`/ver-cv/:id`) y revelar el teléfono/WhatsApp del postulante. **Cada visualización de CV o solicitud de contacto queda auditada en `cv_access_log`.**

---

### 1.4. Derechos ARCO, Privacidad y Gestión de Cuenta (Postulantes y Comercios)
En la sección **"Privacidad y Cuenta"** dentro de cada panel:
1. **Descargar mis datos (`export_my_data`):** Descarga inmediata en formato JSON con todos los datos de perfil, datos privados (incluyendo datos de tutor o fecha de inicio de actividades), postulaciones, avisos, historial de accesos a su CV y constancias de aceptación de términos.
2. **Pausar perfil / avisos:** Permite ocultar temporalmente la visibilidad sin perder la cuenta.
3. **Eliminar mi cuenta (`delete_my_account`):** Borrado inmediato de los datos personales, archivos de CV/avatar/logo, sesiones y postulaciones, conservando únicamente el hash HMAC-SHA256 en la constancia legal de aceptación por el plazo de prescripción.

---

### 1.5. Panel de Administración (`/admin`)
- Moderación de usuarios (activar, suspender, revisar perfiles de postulantes y comercios).
- Moderación de avisos laborales y gestión de denuncias (`reports`) y tickets de soporte (`admin_tickets`) con respuesta por correo (`admin_ticket_replied`).
- Gestión del catálogo de rubros y puestos sugeridos (`industries`).
- Métricas de uso de la plataforma.

---

## 2. Resumen de Seguridad, Auditoría y Retención de Datos

| Mecanismo | Implementación actual |
| :--- | :--- |
| **Constancia de Términos (`terms_acceptances`)** | Registra `user_id`, versión (`2026-11-13`), rol y `email_hash` calculado con **HMAC-SHA256** usando clave secreta en `app_settings` (`terms_hmac_key`), inaccesible para clientes anónimos o autenticados. |
| **Enmascaramiento (`mask_contact_info`)** | Función SQL que reemplaza emails, enlaces `wa.me` (con o sin parámetros), teléfonos con espacios/guiones/puntos (`236.445.678`, `123.456.789`) o precedidos por `$` (`$2364456789`) por `[contacto protegido]`, preservando sueldos (`$1.500.000`), cifras con separador de miles (`12.500.000`), rangos de años (`2015-2020`) y fechas (`12/11/2026`). |
| **Notificaciones por correo (`server_prepare_notification_email` / `server_unmark_notification`)** | Soporta 5 eventos: `new_application`, `application_status_changed`, `admin_ticket_created`, `admin_ticket_replied` y `minor_guardian_notice`. Si Brevo falla, `server_unmark_notification` revierte la marca de envío y, en el caso del tutor, devuelve el intento al contador (`guardian_notice_count`). |
| **Purga automática (`purge_expired_data`)** | Tarea programada diaria (`pg_cron` a las 03:30 UTC): elimina desafíos OTP a los 7 días, sesiones vencidas, notificaciones e intentos a los 90 días, logs de acceso a CV y denuncias cerradas a los 12 meses, cuentas inactivas sin actividad por más de 12 meses y constancias de términos huérfanas a los 24 meses. |
