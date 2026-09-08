import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { InvitesService } from '../../services/invites.service';

// Who is allowed to register. Admins only — and not only in the sense of a
// hidden section: the functions behind it refuse anybody else outright.
@Component({
  selector: 'app-invites-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './invites-panel.html',
  styleUrl: './invites-panel.scss',
})
export class InvitesPanel implements OnInit {
  email = '';
  note = '';

  // Withdrawing is one tap away from a list of names, so it asks first.
  confirming = signal<string | null>(null);

  constructor(public auth: AuthService, public invites: InvitesService) {}

  ngOnInit(): void {
    if (this.auth.isAdmin()) void this.invites.load();
  }

  async add(): Promise<void> {
    if (await this.invites.add(this.email, this.note)) {
      this.email = '';
      this.note = '';
    }
  }

  async remove(email: string): Promise<void> {
    if (this.confirming() !== email) {
      this.confirming.set(email);
      return;
    }
    this.confirming.set(null);
    await this.invites.remove(email);
  }
}
