import { Component } from '@angular/core';

@Component({
  imports: [],
  selector: 'app-home',
  styleUrl: './home.scss',
  templateUrl: './home.html',
})
export class Home {
  readonly currentYear = new Date().getFullYear();
}
