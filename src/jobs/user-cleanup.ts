import cron from 'node-cron';
import { prisma } from '../config/prisma.js';

/**
 * Cron job to delete users whose account status is not ACTIVE after 10 minutes
 * Runs every minute to check for eligible users
 */
export const deleteInactiveUsersJob = () => {
  // Run every minute
  cron.schedule('* * * * *', async () => {
    try {
      const tenMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

      // Find and delete users whose status is not ACTIVE and created more than 10 minutes ago
      const result = await prisma.user.deleteMany({
        where: {
          accountStatus: {
            not: 'ACTIVE'
          },
          createdAt: {
            lte: tenMinutesAgo
          }
        }
      });

      if (result.count > 0) {
        console.log(`[${new Date().toISOString()}] Deleted ${result.count} inactive user(s)`);
      }
    } catch (error) {
      console.error('[Cron Job Error] Failed to delete inactive users:', error);
    }
  });

  console.log('✓ Inactive users cleanup cron job initialized');
};
