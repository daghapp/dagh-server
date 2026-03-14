import swaggerJSDoc from 'swagger-jsdoc';
import { Application } from 'express';
import swaggerUi from 'swagger-ui-express';

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
    servers: [
      {
        url:'http://localhost:3000',
        description: process.env.NODE_ENV === 'production' ? 'Production server' : 'Development server',
      },{
        url:"https://dagh-server-3.onrender.com" ,
        description: "Production server on Render",
      },

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