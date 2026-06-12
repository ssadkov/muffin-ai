import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { getUpcomingPaymentObligations } from '../tools/databaseTools';

const PAYMENT_NOTIFICATION_SOURCE = 'muffin_payment_reminder';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function ensureNotificationPermissions(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;

  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

async function cancelExistingPaymentReminders() {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((notification) => notification.content.data?.source === PAYMENT_NOTIFICATION_SOURCE)
      .map((notification) => Notifications.cancelScheduledNotificationAsync(notification.identifier))
  );
}

function reminderDateFor(payment: any): Date | null {
  const dueDate = new Date(payment.due_date_iso);
  const remindDaysBefore = Number(payment.remind_days_before ?? 3);
  const reminder = new Date(dueDate.getTime() - remindDaysBefore * 24 * 60 * 60 * 1000);
  reminder.setHours(9, 0, 0, 0);

  if (reminder.getTime() <= Date.now()) {
    return null;
  }

  return reminder;
}

export async function schedulePaymentReminders(daysAhead = 45): Promise<number> {
  try {
    const hasPermission = await ensureNotificationPermissions();
    if (!hasPermission) {
      console.log('[PaymentReminders] Notification permission not granted.');
      return 0;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('payments', {
        name: 'Payment reminders',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    await cancelExistingPaymentReminders();

    const payments = getUpcomingPaymentObligations(daysAhead);
    let scheduledCount = 0;

    for (const payment of payments) {
      const reminderDate = reminderDateFor(payment);
      if (!reminderDate) continue;

      await Notifications.scheduleNotificationAsync({
        content: {
          title: `Muffin: ${payment.title}`,
          body: `${payment.amount} ${payment.currency} due ${new Date(payment.due_date_iso).toLocaleDateString()}`,
          data: {
            source: PAYMENT_NOTIFICATION_SOURCE,
            paymentId: payment.id,
            ownerType: payment.owner_type,
          },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: reminderDate,
          channelId: Platform.OS === 'android' ? 'payments' : undefined,
        },
      });
      scheduledCount += 1;
    }

    console.log(`[PaymentReminders] Scheduled ${scheduledCount} payment reminder(s).`);
    return scheduledCount;
  } catch (error) {
    console.warn('[PaymentReminders] Failed to schedule reminders:', error);
    return 0;
  }
}
