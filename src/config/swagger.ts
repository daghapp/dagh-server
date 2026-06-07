import swaggerJSDoc from 'swagger-jsdoc';
import { Application } from 'express';
import swaggerUi from 'swagger-ui-express';

const BackendURL = process.env.API_URL

const swaggerOptions: swaggerJSDoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'DAGH API Documentation',
      version: '1.0.0',
      description: 'API documentation for DAGH server',
      contact: {
        name: 'API Support',
      },
    },
    servers:
      process.env.NODE_ENV === 'production'
        ? [
            { url: BackendURL, description: 'Production server' },
            { url: 'http://localhost:5000', description: 'Local development' },
          ]
        : [
            { url: 'http://localhost:5000', description: 'Local development' },
            { url: BackendURL, description: 'Production server' },
          ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
  },
  apis: ['./src/routes/*.ts', './src/Modules/**/*.ts'], // Path to the API routes
};

const swaggerSpec = swaggerJSDoc(swaggerOptions);

export const setupSwagger = (app: Application) => {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { customCss: '' }));
  console.log('Swagger documentation available at /api-docs');
};

export default swaggerSpec;