import express from 'express';
import dotenv from 'dotenv';
import { router as AuthRoutes } from './routes/index';
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;


app.use(express.json());

app.get('/', (req, res) => {
  res.send('Hello, World!');
});

//user authentication routes
app.use('/auth', AuthRoutes);

export default app