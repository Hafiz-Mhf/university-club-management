# University Student Organization Management Platform

## Vision

Build a multi-tenant platform that allows every university club or
society to manage its organization independently while maintaining
strong security, privacy, and data isolation.

Instead of being just an event registration system, the platform becomes
the operating system for student organizations.

## Problem Statement

Many student organizations rely on scattered tools such as Google Forms,
spreadsheets, email, and shared drives. Data is often lost when
committees change, certificates are difficult to distribute, and
attendance tracking is manual.

This platform centralizes these workflows into a single secure
application.

## Platform Structure

University - KICT - IoTeams - ACM - IEEE - KENMS - AIKOL - KOED - ...

Each organization has: - Own dashboard - Own committee - Own members -
Own events - Own storage - Own analytics - Own settings

No organization can access another organization's data.

## Core Modules

### Organization Management

-   Logo
-   Description
-   Advisors
-   Social links
-   Storage quota
-   Organization settings

### Committee Management

Roles: - President - Vice President - Secretary - Treasurer - Event
Director - Committee - Volunteer

Role-Based Access Control (RBAC) determines permissions.

### Member Management

Store: - Student ID - Faculty - Programme - Intake - Email - Phone

Support: - Active members - Alumni - Committee history

### Event Management

Each event includes: - Banner - Venue - Capacity - Registration -
Attendance - Certificates - Feedback - Sponsors - Expenses

### Registration

Replace Google Forms with: - Custom registration forms - Approval
workflow - Waiting list - Export - Future payment integration

### QR Attendance

Unique QR code per participant. Scanning records attendance, timestamp,
and status automatically.

### Certificate Repository

Initially: - Committee uploads certificates. - Participants log in and
download their own certificates.

Future: - Automatic certificate generation.

### Analytics

Dashboard examples: - Number of events - Attendance rate - New members -
Faculty/programme distribution - Certificate downloads - Registration
trends - Committee activity

## Security Architecture

### Authentication

-   Email login
-   Optional MFA
-   Future university SSO

### Authorization

Hierarchy: - Super Admin - University Admin - Advisor - President -
Committee - Volunteer - Participant

### Multi-Tenancy

Every organization has isolated data. No cross-organization access.

### Audit Logs

Track: - Who performed an action - What action - When - Device/IP
(optional)

## PDPA Considerations

Privacy should be designed into the platform.

Features: - User consent with timestamp - Collect only necessary
personal data - Configurable data retention - Export personal data -
Delete account request - Privacy preferences - Encryption at rest -
HTTPS - Secure password hashing - Session security

## Risks

### 1. Scope

Large project. Build incrementally.

### 2. Security

Authentication and authorization mistakes can expose data.

### 3. File Storage

Secure handling of certificates, photos, and documents is required.

### 4. Privacy

Must comply with PDPA principles and protect participant information.

### 5. Permission Complexity

RBAC becomes harder as features increase.

## Feasibility Assessment

Frontend: High

Backend: High (moderately complex)

Database: Excellent learning opportunity

Security: Challenging but achievable

Overall: Highly feasible if developed in phases.

## Suggested Future Features

### Digital Club Workspace

-   Announcements
-   Meeting minutes
-   SOP repository
-   Yearly reports
-   Asset inventory
-   Committee handover documentation

### Public Club Page

-   Upcoming events
-   Gallery
-   Contacts
-   Achievements
-   Registration links

### Alumni Archive

Maintain committee history and preserve organizational knowledge.

### Event Lifecycle

Proposal → Approval → Planning → Registration → Event Day → Attendance →
Certificates → Post-event Report → Archive

## Why This Project Matters

This project demonstrates: - Enterprise application architecture -
Multi-tenancy - Role-based access control - Secure authentication -
Privacy-by-design - Analytics - File management - Scalable database
design - Real-world problem solving

It also has the potential to be adopted by real student organizations,
making it significantly stronger than a typical portfolio CRUD
application.
