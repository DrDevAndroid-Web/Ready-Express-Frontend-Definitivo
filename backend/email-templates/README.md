# Confirmación de email en Supabase Auth

El backend solicita el envío mediante `auth.signUp()` y `auth.resend()`. El correo de confirmación no sale por `SMTP_*` ni por Resend del backend; su proveedor y plantilla se configuran en **Supabase → Authentication**.

Para ofrecer código **y** enlace, copia `supabase-confirm-signup.html` a la plantilla **Confirm signup** del proyecto Supabase. Comprueba que la versión activa conserve `{{ .Token }}` y `{{ .ConfirmationURL }}`. El archivo de este repositorio no se sincroniza automáticamente con el panel. Si la plantilla activa solo contiene el enlace, la tienda también permite confirmar mediante ese enlace.

Incluye `https://www.readyexpressnow.com/cuenta-confirmada.html` en **Redirect URLs** de Supabase. Para otro dominio, configura `FRONTEND_PUBLIC_URL` o `FRONTEND_EMAIL_CONFIRM_URL` en el backend y autoriza esa URL en Supabase. Verifica en el panel que **Confirm email** y el proveedor SMTP de Auth estén habilitados. Tras un cambio de plantilla o proveedor, haz un registro de prueba con un email nuevo y confirma la recepción, el código, el enlace y el acceso posterior.
