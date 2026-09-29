# Políticas de acceso (RLS)

Estas políticas se aplican una vez que ya cargaste el esquema y las tablas en tu proyecto Supabase. El archivo `supabase/policies.sql` contiene las sentencias SQL completas; puedes abrirlo desde el editor de SQL del panel o ejecutarlo con la CLI:

```bash
supabase db query --file supabase/policies.sql
```

Si prefieres usar el editor integrado de Supabase, copia el contenido del archivo y ejecútalo desde **Database > SQL editor**.

## ¿Qué hacen estas políticas?

| Tabla | Restricciones |
|-|-|
| `students` | 1) El `director` puede leer todos los registros. 2) El `orientador` sólo ve a los alumnos de los grupos a su cargo. 3) Cada `estudiante` sólo puede leer su propio perfil comparando el correo autenticado. |
| `timetables` | 1) El personal con rol `director`, `orientador` o `profesor` puede consultar los horarios completos. 2) Un `estudiante` sólo ve los registros que pertenecen a su grupo (el correo coincide con el suyo). |

Las políticas asumen que: `students.email` guarda el correo real del alumno y `groups.counselor_id` referencia el ID del orientador dentro de la tabla `users`. Si tu esquema cambia, ajusta los `JOIN` o condiciones de la política en consecuencia.

## Verificación

1. Ve a **Database > Table Editor > students** y valida que la pestaña "RLS" está habilitada y las políticas aparecen. Repite para `timetables`.
2. Prueba el acceso autenticándote con distintos usuarios en la app y confirma que los estudiantes solo ven su propio horario/calificaciones y el personal sigue teniendo acceso completo.
