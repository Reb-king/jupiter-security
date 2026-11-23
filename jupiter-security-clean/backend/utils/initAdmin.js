/**
 * DEPRECATED: Default administrator initialization disabled.
 *
 * The existing Managing Director account is:
 * ID: 1
 * Employee Code: JUP-MD-001
 *
 * This script must never create another administrator
 * or reset the existing account password.
 *
 * Use the normal account-management process for future changes.
 */

console.error('ADMIN INITIALIZATION DISABLED.');
console.error('The existing Managing Director account must be preserved.');
console.error('No database changes were made.');

process.exitCode = 1;
