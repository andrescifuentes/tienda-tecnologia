# Recursos visuales ANGIE TECH

- `brand/angie-tech-logo.png` es una copia sin redibujar de `refenrcias/angie-tech-logo-crop.png`.
- `photography/login.jpg` y `home.jpg` contienen únicamente las regiones fotográficas de las referencias 01 y 02. No incluyen controles, marcos de teléfono, cifras ni tarjetas.
- Los 18 productos iniciales tienen una fotografía local independiente, identificada por SKU en `products/sources.json`. Este manifiesto registra procedencia, archivo y carácter provisional. Algunas fotografías de fabricante ilustran una variante de la misma familia; no cambian el nombre, precio, seriales o características del registro demo.
- `ProductThumbnail` y `productPhoto` en `components/TechVisuals.jsx` consultan ese manifiesto. Inventario, venta y carrito comparten la misma fotografía; no realizan solicitudes a fabricantes durante el uso.
- Para agregar la foto de un producto nuevo, guarda un JPG/PNG/WebP en `products/` y agrega su SKU y `filename` al manifiesto. Si no tiene foto se identifica expresamente como «Foto por añadir»; no se inventa una imagen ni se reutiliza la de otro producto.
- Las tipografías Inter y Playfair Display se sirven desde `public/fonts/`, con sus licencias OFL. No se depende de Google Fonts en ejecución.

Las referencias completas siguen en `refenrcias/` y se utilizan para comparación visual, nunca como pantallas incrustadas en la aplicación.
