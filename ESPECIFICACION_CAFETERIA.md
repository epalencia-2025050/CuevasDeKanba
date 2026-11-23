# Especificación: Sistema de Gestión de Cafetería

## Orden de Módulos

1. Módulo de Clasificación y Categorización (NUEVO)
2. Ventas
3. Control de Inventario
4. Control de Gastos
5. Estadísticas y Reportes

---

## Vista de Usuario (Parte Visual / Punto de Venta / Operativa)

### 1. Módulo de Clasificación y Categorización
- Visualización de productos organizados por categorías y conceptos.
- Menú visual agrupado por tipos de producto (bebidas calientes, frías, repostería, insumos, etc.).
- Búsqueda y filtrado de productos por clasificación.
- Visualización de precios por categoría.

### 2. Ventas
- Registro y administración de productos y precios (vista operativa de caja).
- Registro de ventas y formas de pago.
- Cálculo automático del importe total de cada venta.
- Emisión de comprobantes internos (tickets/facturas).
- Consulta de ventas por período (vista rápida del cajero).

### 3. Control de Inventario (Consulta Operativa)
- Consulta de existencias disponibles.
- Historial de movimientos de inventario (solo lectura para usuario de caja).
- Descuento automático de existencias por venta de productos registrados (proceso interno).

---

## Vista del Administrador (Back-office / Gestión)

### 1. Módulo de Clasificación y Categorización (NUEVO)
- Registro, edición y eliminación de categorías de productos e insumos.
- Definición de conceptos de clasificación para gastos.
- Asignación de productos a categorías.
- Clasificación de gastos por tipo y concepto.
- Gestión de clasificaciones transversales para reportes y estadísticas.

### 2. Ventas
- Registro y administración de productos y precios.
- Registro de ventas y formas de pago.
- Cálculo automático del importe total de cada venta.
- Emisión de comprobantes internos.
- Consulta de ventas por período.

### 3. Control de Inventario
- Registro de productos e insumos.
- Registro de entradas, salidas y ajustes de inventario.
- Consulta de existencias disponibles.
- Historial de movimientos de inventario.
- Descuento automático de existencias por venta de productos registrados.

### 4. Control de Gastos
- Registro y clasificación de gastos.
- Consulta de gastos por período.
- Identificación del concepto, monto y fecha de cada gasto.

### 5. Estadísticas y Reportes
- Consulta de ventas e ingresos por período.
- Identificación de los productos más vendidos.
- Reportes de gastos de operación.
- Consulta de existencias y movimientos de inventario.
- Exportación de reportes a formatos Excel y PDF.

---

> **Nota:** El contenido está listo para ser versionado. El directorio actual no es un repositorio de Git, por lo que para subirlo a la rama `emendoza` es necesario inicializar Git o contar con un repositorio remoto configurado.
