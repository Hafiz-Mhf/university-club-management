import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { MailerService } from './mailer.service';

const sendMailMock = jest.fn().mockResolvedValue(undefined);
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: sendMailMock })),
}));

describe('MailerService', () => {
  let config: Record<string, unknown>;

  async function build(): Promise<MailerService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        MailerService,
        { provide: ConfigService, useValue: { get: (key: string) => config[key] } },
      ],
    }).compile();
    return moduleRef.get(MailerService);
  }

  beforeEach(() => {
    sendMailMock.mockClear();
    (nodemailer.createTransport as jest.Mock).mockClear();
    config = {
      MAIL_HOST: 'localhost',
      MAIL_PORT: 1025,
      MAIL_USER: '',
      MAIL_PASS: '',
      MAIL_FROM: 'no-reply@ucm.local',
    };
  });

  it('creates a transport with no auth when MAIL_USER is empty', async () => {
    await build();
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'localhost', port: 1025, auth: undefined }),
    );
  });

  it('creates a transport with auth when MAIL_USER is set', async () => {
    config.MAIL_USER = 'smtpuser';
    config.MAIL_PASS = 'smtppass';
    await build();
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { user: 'smtpuser', pass: 'smtppass' } }),
    );
  });

  it('sendMail calls the transporter with from/to/subject/text', async () => {
    const service = await build();
    await service.sendMail({ to: 'a@b.com', subject: 'Hi', text: 'Body' });
    expect(sendMailMock).toHaveBeenCalledWith({
      from: 'no-reply@ucm.local', to: 'a@b.com', subject: 'Hi', text: 'Body',
    });
  });
});
