import { Equals, IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @MinLength(1)
  fullName!: string;

  // PDPA: explicit consent to the account privacy policy. Missing or false → 400.
  @Equals(true)
  consent!: boolean;
}
