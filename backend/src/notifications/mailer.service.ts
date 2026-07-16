import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface SendMailParams {
  to: string;
  subject: string;
  text: string;
}

@Injectable()
export class MailerService {
  private readonly transporter: nodemailer.Transporter;

  constructor(private readonly config: ConfigService) {
    const user = this.config.get<string>('MAIL_USER', '');
    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('MAIL_HOST', 'localhost'),
      port: this.config.get<number>('MAIL_PORT', 1025),
      auth: user ? { user, pass: this.config.get<string>('MAIL_PASS', '') } : undefined,
    });
  }

  async sendMail(params: SendMailParams): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.get<string>('MAIL_FROM'),
      to: params.to,
      subject: params.subject,
      text: params.text,
    });
  }
}
