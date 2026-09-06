import swaggerJSDoc from "swagger-jsdoc";
import { Application } from "express";
import swaggerUi from "swagger-ui-express";

const BackendURL = process.env.API_URL;

const swaggerOptions: swaggerJSDoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Diaspora Sync API Documentation",
      version: "1.0.0",
      description: "API documentation for Diaspora Sync server",
      contact: {
        name: "API Support",
      },
    },
    servers:
      process.env.NODE_ENV === "production"
        ? [
            { url: BackendURL, description: "Production server" },
            { url: "http://localhost:5000", description: "Local development" },
          ]
        : [
            { url: "http://localhost:5000", description: "Local development" },
            { url: BackendURL, description: "Production server" },
          ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
  },
  // In production (Docker image) only the compiled dist/ is shipped, so JSDoc
  // swagger comments are read from the compiled .js files. Locally, source .ts
  // files are used. tsc preserves JSDoc comments (no removeComments).
  apis:
    process.env.NODE_ENV === "production"
      ? ["./dist/src/routes/*.js", "./dist/src/modules/**/*.js", "./dist/src/server.js"]
      : ["./src/routes/*.ts", "./src/modules/**/*.ts", "./src/server.ts"],
};

const swaggerSpec = swaggerJSDoc(swaggerOptions);

export const setupSwagger = (app: Application) => {
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, { customCss: "" }));
  console.log("Swagger documentation available at /api-docs");
};

export default swaggerSpec;
