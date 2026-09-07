import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UpdateService } from '../../services/update.service';

// The version this app is running, a manual "check for updates", and the
// release notes + install button once there is something newer. The banner is
// the interruption; this is where you come looking.
@Component({
  selector: 'app-update-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './update-panel.html',
  styleUrl: './update-panel.scss',
})
export class UpdatePanel {
  constructor(public update: UpdateService) {}
}
