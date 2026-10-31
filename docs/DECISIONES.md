# Decisiones de Producto y Reglas de Negocio

1. **Un correo electrónico = Un único rol:**
   Cada cuenta de email se vincula a un solo rol (`candidate` o `employer`). Si una persona desea buscar empleo y además publicar como comercio, utiliza un correo para cada rol.

2. **Ingreso sin contraseñas mediante código de 6 dígitos (OTP por Email):**
   - La cuenta se crea en el **Paso 1** del registro verificando el correo con un código de 6 dígitos enviado mediante **Brevo SMTP**, mostrando como remitente (`FROM Name`) **Bolsa de Empleo Tejedor**.
   - Al crearse la cuenta en el Paso 1, el usuario ya cuenta con sesión activa para subir su foto comprimida, su CV en PDF con permisos de Storage y guardar su avance.

3. **Moderación reactiva (Publicación inmediata):**
   - No hay cuello de botella por aprobación previa: los perfiles completos y las búsquedas laborales pasan a estado `active` inmediatamente.
   - Se complementa con email verificado por OTP, botón **"Denunciar"** en perfiles/avisos y moderación reactiva con un clic desde `/admin` (**Pausar**, **Reactivar** o **Eliminar**).

4. **Filtros 100% Cliqueables (con opción "Otro"):**
   - **Situación laboral actual:** *"Estoy buscando trabajo"* vs. *"Tengo trabajo, pero busco cambiar o sumar horas"*.
   - **Disponibilidad horaria:** Full-time, Part-time, Por turnos / Rotativo, Fines de semana / Francos, Por hora / Temporal / Changas.
   - **Nivel de formación:** Primario, Secundario en curso, Secundario completo, Terciario / Técnico, Universitario, Cursos y Oficios.
   - **Rubros y Puestos sugeridos:** Selección por chips con opción **"Otro"** para que el administrador pueda incorporar nuevos oficios o rubros al catálogo oficial desde `/admin/rubros`.

5. **Panel `/admin` unificado:**
   - Acceso directo por URL (`/admin`), protegido en base de datos por rol `admin`.
   - Tarjetas de resumen, listados de Postulantes, Comercios y Búsquedas con los mismos filtros cliqueables, y ventana emergente (Pop-up) con ficha completa, acceso a WhatsApp, visor de CV y acciones de moderación.
